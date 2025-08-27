import { invariant, isPlainObject } from '@zenstackhq/common-helpers';
import type { Expression, ExpressionBuilder, ExpressionWrapper, SqlBool, ValueNode } from 'kysely';
import { expressionBuilder, sql, type SelectQueryBuilder } from 'kysely';
import { match, P } from 'ts-pattern';
import type { BuiltinType, DataSourceProviderType, FieldDef, GetModels, ModelDef, SchemaDef } from '../../../schema';
import { enumerate } from '../../../utils/enumerate';
import type { OrArray } from '../../../utils/type-utils';
import { AGGREGATE_OPERATORS, DELEGATE_JOINED_FIELD_PREFIX, LOGICAL_COMBINATORS } from '../../constants';
import type {
    BooleanFilter,
    BytesFilter,
    DateTimeFilter,
    FindArgs,
    OrderBy,
    SortOrder,
    StringFilter,
} from '../../crud-types';
import { InternalError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import {
    aggregate,
    buildFieldRef,
    buildJoinPairs,
    ensureArray,
    flattenCompoundUniqueFilters,
    getDelegateDescendantModels,
    getIdFields,
    getManyToManyRelation,
    getRelationForeignKeyFieldPairs,
    isEnum,
    isInheritedField,
    isRelationField,
    makeDefaultOrderBy,
    requireField,
    requireModel,
} from '../../query-utils';

export abstract class BaseCrudDialect<Schema extends SchemaDef> {
    constructor(
        protected readonly schema: Schema,
        protected readonly options: ClientOptions<Schema>,
    ) {}

    transformPrimitive(value: unknown, _type: BuiltinType, _forArrayField: boolean) {
        return value;
    }

    // #region common query builders

    buildSelectModel(eb: ExpressionBuilder<any, any>, model: string, modelAlias: string) {
        const modelDef = requireModel(this.schema, model);
        let result = eb.selectFrom(model === modelAlias ? model : `${model} as ${modelAlias}`);
        // join all delegate bases
        let joinBase = modelDef.baseModel;
        while (joinBase) {
            result = this.buildDelegateJoin(model, modelAlias, joinBase, result);
            joinBase = requireModel(this.schema, joinBase).baseModel;
        }
        return result;
    }

    buildFilterSortTake(
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true>,
        query: SelectQueryBuilder<any, any, {}>,
        modelAlias: string,
    ) {
        let result = query;

        // where
        if (args.where) {
            result = result.where((eb) => this.buildFilter(eb, model, modelAlias, args?.where));
        }

        // skip && take
        let negateOrderBy = false;
        const skip = args.skip;
        let take = args.take;
        if (take !== undefined && take < 0) {
            negateOrderBy = true;
            take = -take;
        }
        result = this.buildSkipTake(result, skip, take);

        // orderBy
        result = this.buildOrderBy(
            result,
            model,
            modelAlias,
            args.orderBy,
            skip !== undefined || take !== undefined,
            negateOrderBy,
        );

        // distinct
        if ('distinct' in args && (args as any).distinct) {
            const distinct = ensureArray((args as any).distinct) as string[];
            if (this.supportsDistinctOn) {
                result = result.distinctOn(distinct.map((f) => sql.ref(`${modelAlias}.${f}`)));
            } else {
                throw new QueryError(`"distinct" is not supported by "${this.schema.provider.type}" provider`);
            }
        }

        if (args.cursor) {
            result = this.buildCursorFilter(model, result, args.cursor, args.orderBy, negateOrderBy, modelAlias);
        }
        return result;
    }

    buildFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        modelAlias: string,
        where: boolean | object | undefined,
    ) {
        if (where === true || where === undefined) {
            return this.true(eb);
        }

        if (where === false) {
            return this.false(eb);
        }

        let result = this.true(eb);
        const _where = flattenCompoundUniqueFilters(this.schema, model, where);

        for (const [key, payload] of Object.entries(_where)) {
            if (payload === undefined) {
                continue;
            }

            if (key.startsWith('$')) {
                continue;
            }

            if (this.isLogicalCombinator(key)) {
                result = this.and(eb, result, this.buildCompositeFilter(eb, model, modelAlias, key, payload));
                continue;
            }

            const fieldDef = requireField(this.schema, model, key);

            if (fieldDef.relation) {
                result = this.and(eb, result, this.buildRelationFilter(eb, model, modelAlias, key, fieldDef, payload));
            } else {
                // if the field is from a base model, build a reference from that model
                const fieldRef = this.fieldRef(
                    fieldDef.originModel ?? model,
                    key,
                    eb,
                    fieldDef.originModel ?? modelAlias,
                );
                if (fieldDef.array) {
                    result = this.and(eb, result, this.buildArrayFilter(eb, fieldRef, fieldDef, payload));
                } else {
                    result = this.and(eb, result, this.buildPrimitiveFilter(eb, fieldRef, fieldDef, payload));
                }
            }
        }

        // call expression builder and combine the results
        if ('$expr' in _where && typeof _where['$expr'] === 'function') {
            result = this.and(eb, result, _where['$expr'](eb));
        }

        return result;
    }

    private buildCursorFilter(
        model: string,
        query: SelectQueryBuilder<any, any, any>,
        cursor: FindArgs<Schema, GetModels<Schema>, true>['cursor'],
        orderBy: FindArgs<Schema, GetModels<Schema>, true>['orderBy'],
        negateOrderBy: boolean,
        modelAlias: string,
    ) {
        const _orderBy = orderBy ?? makeDefaultOrderBy(this.schema, model);

        const orderByItems = ensureArray(_orderBy).flatMap((obj) => Object.entries<SortOrder>(obj));

        const eb = expressionBuilder<any, any>();
        const subQueryAlias = `${model}$cursor$sub`;
        const cursorFilter = this.buildFilter(eb, model, subQueryAlias, cursor);

        let result = query;
        const filters: ExpressionWrapper<any, any, any>[] = [];

        for (let i = orderByItems.length - 1; i >= 0; i--) {
            const andFilters: ExpressionWrapper<any, any, any>[] = [];

            for (let j = 0; j <= i; j++) {
                const [field, order] = orderByItems[j]!;
                const _order = negateOrderBy ? (order === 'asc' ? 'desc' : 'asc') : order;
                const op = j === i ? (_order === 'asc' ? '>=' : '<=') : '=';
                andFilters.push(
                    eb(
                        eb.ref(`${modelAlias}.${field}`),
                        op,
                        this.buildSelectModel(eb, model, subQueryAlias)
                            .select(`${subQueryAlias}.${field}`)
                            .where(cursorFilter),
                    ),
                );
            }

            filters.push(eb.and(andFilters));
        }

        result = result.where((eb) => eb.or(filters));

        return result;
    }

    private isLogicalCombinator(key: string): key is (typeof LOGICAL_COMBINATORS)[number] {
        return LOGICAL_COMBINATORS.includes(key as any);
    }

    protected buildCompositeFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        modelAlias: string,
        key: (typeof LOGICAL_COMBINATORS)[number],
        payload: any,
    ): Expression<SqlBool> {
        return match(key)
            .with('AND', () =>
                this.and(
                    eb,
                    ...enumerate(payload).map((subPayload) => this.buildFilter(eb, model, modelAlias, subPayload)),
                ),
            )
            .with('OR', () =>
                this.or(
                    eb,
                    ...enumerate(payload).map((subPayload) => this.buildFilter(eb, model, modelAlias, subPayload)),
                ),
            )
            .with('NOT', () => eb.not(this.buildCompositeFilter(eb, model, modelAlias, 'AND', payload)))
            .exhaustive();
    }

    private buildRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        modelAlias: string,
        field: string,
        fieldDef: FieldDef,
        payload: any,
    ) {
        if (!fieldDef.array) {
            return this.buildToOneRelationFilter(eb, model, modelAlias, field, fieldDef, payload);
        } else {
            return this.buildToManyRelationFilter(eb, model, modelAlias, field, fieldDef, payload);
        }
    }

    private buildToOneRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        modelAlias: string,
        field: string,
        fieldDef: FieldDef,
        payload: any,
    ): Expression<SqlBool> {
        if (payload === null) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(this.schema, model, field);

            if (ownedByModel && !fieldDef.originModel) {
                // can be short-circuited to FK null check
                return this.and(eb, ...keyPairs.map(({ fk }) => eb(sql.ref(`${modelAlias}.${fk}`), 'is', null)));
            } else {
                // translate it to `{ is: null }` filter
                return this.buildToOneRelationFilter(eb, model, modelAlias, field, fieldDef, { is: null });
            }
        }

        const joinAlias = `${modelAlias}$${field}`;
        const joinPairs = buildJoinPairs(
            this.schema,
            model,
            // if field is from a base, use the base model to join
            fieldDef.originModel ?? modelAlias,
            field,
            joinAlias,
        );
        const filterResultField = `${field}$filter`;

        const joinSelect = eb
            .selectFrom(`${fieldDef.type} as ${joinAlias}`)
            .where(() => this.and(eb, ...joinPairs.map(([left, right]) => eb(sql.ref(left), '=', sql.ref(right)))))
            .select(() => eb.fn.count(eb.lit(1)).as(filterResultField));

        const conditions: Expression<SqlBool>[] = [];

        if ('is' in payload || 'isNot' in payload) {
            if ('is' in payload) {
                if (payload.is === null) {
                    // check if not found
                    conditions.push(eb(joinSelect, '=', 0));
                } else {
                    // check if found
                    conditions.push(
                        eb(
                            joinSelect.where(() => this.buildFilter(eb, fieldDef.type, joinAlias, payload.is)),
                            '>',
                            0,
                        ),
                    );
                }
            }

            if ('isNot' in payload) {
                if (payload.isNot === null) {
                    // check if found
                    conditions.push(eb(joinSelect, '>', 0));
                } else {
                    conditions.push(
                        this.or(
                            eb,
                            // is null
                            eb(joinSelect, '=', 0),
                            // found one that matches the filter
                            eb(
                                joinSelect.where(() => this.buildFilter(eb, fieldDef.type, joinAlias, payload.isNot)),
                                '=',
                                0,
                            ),
                        ),
                    );
                }
            }
        } else {
            conditions.push(
                eb(
                    joinSelect.where(() => this.buildFilter(eb, fieldDef.type, joinAlias, payload)),
                    '>',
                    0,
                ),
            );
        }

        return this.and(eb, ...conditions);
    }

    private buildToManyRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        modelAlias: string,
        field: string,
        fieldDef: FieldDef,
        payload: any,
    ) {
        // null check needs to be converted to fk "is null" checks
        if (payload === null) {
            return eb(sql.ref(`${modelAlias}.${field}`), 'is', null);
        }

        const relationModel = fieldDef.type;

        // evaluating the filter involves creating an inner select,
        // give it an alias to avoid conflict
        const relationFilterSelectAlias = `${modelAlias}$${field}$filter`;

        const buildPkFkWhereRefs = (eb: ExpressionBuilder<any, any>) => {
            const m2m = getManyToManyRelation(this.schema, model, field);
            if (m2m) {
                // many-to-many relation
                const modelIdField = getIdFields(this.schema, model)[0]!;
                const relationIdField = getIdFields(this.schema, relationModel)[0]!;
                return eb(
                    sql.ref(`${relationFilterSelectAlias}.${relationIdField}`),
                    'in',
                    eb
                        .selectFrom(m2m.joinTable)
                        .select(`${m2m.joinTable}.${m2m.otherFkName}`)
                        .whereRef(
                            sql.ref(`${m2m.joinTable}.${m2m.parentFkName}`),
                            '=',
                            sql.ref(`${modelAlias}.${modelIdField}`),
                        ),
                );
            } else {
                const relationKeyPairs = getRelationForeignKeyFieldPairs(this.schema, model, field);

                let result = this.true(eb);
                for (const { fk, pk } of relationKeyPairs.keyPairs) {
                    if (relationKeyPairs.ownedByModel) {
                        result = this.and(
                            eb,
                            result,
                            eb(sql.ref(`${modelAlias}.${fk}`), '=', sql.ref(`${relationFilterSelectAlias}.${pk}`)),
                        );
                    } else {
                        result = this.and(
                            eb,
                            result,
                            eb(sql.ref(`${modelAlias}.${pk}`), '=', sql.ref(`${relationFilterSelectAlias}.${fk}`)),
                        );
                    }
                }
                return result;
            }
        };

        let result = this.true(eb);

        for (const [key, subPayload] of Object.entries(payload)) {
            if (!subPayload) {
                continue;
            }

            switch (key) {
                case 'some': {
                    result = this.and(
                        eb,
                        result,
                        eb(
                            this.buildSelectModel(eb, relationModel, relationFilterSelectAlias)
                                .select((eb1) => eb1.fn.count(eb1.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    this.buildFilter(eb1, relationModel, relationFilterSelectAlias, subPayload),
                                ),
                            '>',
                            0,
                        ),
                    );
                    break;
                }

                case 'every': {
                    result = this.and(
                        eb,
                        result,
                        eb(
                            this.buildSelectModel(eb, relationModel, relationFilterSelectAlias)
                                .select((eb1) => eb1.fn.count(eb1.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    eb1.not(
                                        this.buildFilter(eb1, relationModel, relationFilterSelectAlias, subPayload),
                                    ),
                                ),
                            '=',
                            0,
                        ),
                    );
                    break;
                }

                case 'none': {
                    result = this.and(
                        eb,
                        result,
                        eb(
                            this.buildSelectModel(eb, relationModel, relationFilterSelectAlias)
                                .select((eb1) => eb1.fn.count(eb1.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    this.buildFilter(eb1, relationModel, relationFilterSelectAlias, subPayload),
                                ),
                            '=',
                            0,
                        ),
                    );
                    break;
                }
            }
        }

        return result;
    }

    private buildArrayFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        fieldDef: FieldDef,
        payload: any,
    ) {
        const clauses: Expression<SqlBool>[] = [];
        const fieldType = fieldDef.type as BuiltinType;

        for (const [key, _value] of Object.entries(payload)) {
            if (_value === undefined) {
                continue;
            }

            const value = this.transformPrimitive(_value, fieldType, !!fieldDef.array);

            switch (key) {
                case 'equals': {
                    clauses.push(this.buildLiteralFilter(eb, fieldRef, fieldType, eb.val(value)));
                    break;
                }

                case 'has': {
                    clauses.push(eb(fieldRef, '@>', eb.val([value])));
                    break;
                }

                case 'hasEvery': {
                    clauses.push(eb(fieldRef, '@>', eb.val(value)));
                    break;
                }

                case 'hasSome': {
                    clauses.push(eb(fieldRef, '&&', eb.val(value)));
                    break;
                }

                case 'isEmpty': {
                    clauses.push(eb(fieldRef, value === true ? '=' : '!=', eb.val([])));
                    break;
                }

                default: {
                    throw new InternalError(`Invalid array filter key: ${key}`);
                }
            }
        }

        return this.and(eb, ...clauses);
    }

    buildPrimitiveFilter(eb: ExpressionBuilder<any, any>, fieldRef: Expression<any>, fieldDef: FieldDef, payload: any) {
        if (payload === null) {
            return eb(fieldRef, 'is', null);
        }

        if (isEnum(this.schema, fieldDef.type)) {
            return this.buildEnumFilter(eb, fieldRef, fieldDef, payload);
        }

        return (
            match(fieldDef.type as BuiltinType)
                .with('String', () => this.buildStringFilter(eb, fieldRef, payload))
                .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                    this.buildNumberFilter(eb, fieldRef, type, payload),
                )
                .with('Boolean', () => this.buildBooleanFilter(eb, fieldRef, payload))
                .with('DateTime', () => this.buildDateTimeFilter(eb, fieldRef, payload))
                .with('Bytes', () => this.buildBytesFilter(eb, fieldRef, payload))
                // TODO: JSON filters
                .with('Json', () => {
                    throw new InternalError('JSON filters are not supported yet');
                })
                .with('Unsupported', () => {
                    throw new QueryError(`Unsupported field cannot be used in filters`);
                })
                .exhaustive()
        );
    }

    private buildLiteralFilter(eb: ExpressionBuilder<any, any>, lhs: Expression<any>, type: BuiltinType, rhs: unknown) {
        return eb(lhs, '=', rhs !== null && rhs !== undefined ? this.transformPrimitive(rhs, type, false) : rhs);
    }

    private buildStandardFilter(
        eb: ExpressionBuilder<any, any>,
        type: BuiltinType,
        payload: any,
        lhs: Expression<any>,
        getRhs: (value: unknown) => any,
        recurse: (value: unknown) => Expression<SqlBool>,
        throwIfInvalid = false,
        onlyForKeys: string[] | undefined = undefined,
        excludeKeys: string[] = [],
    ) {
        if (payload === null || !isPlainObject(payload)) {
            return {
                conditions: [this.buildLiteralFilter(eb, lhs, type, payload)],
                consumedKeys: [],
            };
        }

        const conditions: Expression<SqlBool>[] = [];
        const consumedKeys: string[] = [];

        for (const [op, value] of Object.entries(payload)) {
            if (onlyForKeys && !onlyForKeys.includes(op)) {
                continue;
            }
            if (excludeKeys.includes(op)) {
                continue;
            }
            const rhs = Array.isArray(value) ? value.map(getRhs) : getRhs(value);
            const condition = match(op)
                .with('equals', () => (rhs === null ? eb(lhs, 'is', null) : eb(lhs, '=', rhs)))
                .with('in', () => {
                    invariant(Array.isArray(rhs), 'right hand side must be an array');
                    if (rhs.length === 0) {
                        return this.false(eb);
                    } else {
                        return eb(lhs, 'in', rhs);
                    }
                })
                .with('notIn', () => {
                    invariant(Array.isArray(rhs), 'right hand side must be an array');
                    if (rhs.length === 0) {
                        return this.true(eb);
                    } else {
                        return eb.not(eb(lhs, 'in', rhs));
                    }
                })
                .with('lt', () => eb(lhs, '<', rhs))
                .with('lte', () => eb(lhs, '<=', rhs))
                .with('gt', () => eb(lhs, '>', rhs))
                .with('gte', () => eb(lhs, '>=', rhs))
                .with('not', () => eb.not(recurse(value)))
                // aggregations
                .with(P.union(...AGGREGATE_OPERATORS), (op) => {
                    const innerResult = this.buildStandardFilter(
                        eb,
                        type,
                        value,
                        aggregate(eb, lhs, op),
                        getRhs,
                        recurse,
                        throwIfInvalid,
                    );
                    consumedKeys.push(...innerResult.consumedKeys);
                    return this.and(eb, ...innerResult.conditions);
                })
                .otherwise(() => {
                    if (throwIfInvalid) {
                        throw new QueryError(`Invalid filter key: ${op}`);
                    } else {
                        return undefined;
                    }
                });

            if (condition) {
                conditions.push(condition);
                consumedKeys.push(op);
            }
        }

        return { conditions, consumedKeys };
    }

    private buildStringFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        payload: StringFilter<Schema, true, boolean>,
    ) {
        let mode: 'default' | 'insensitive' | undefined;
        if (payload && typeof payload === 'object' && 'mode' in payload) {
            mode = payload.mode;
        }

        const { conditions, consumedKeys } = this.buildStandardFilter(
            eb,
            'String',
            payload,
            mode === 'insensitive' ? eb.fn('lower', [fieldRef]) : fieldRef,
            (value) => this.prepStringCasing(eb, value, mode),
            (value) => this.buildStringFilter(eb, fieldRef, value as StringFilter<Schema, true, boolean>),
        );

        if (payload && typeof payload === 'object') {
            for (const [key, value] of Object.entries(payload)) {
                if (key === 'mode' || consumedKeys.includes(key)) {
                    // already consumed
                    continue;
                }

                const condition = match(key)
                    .with('contains', () =>
                        mode === 'insensitive'
                            ? eb(fieldRef, 'ilike', sql.val(`%${value}%`))
                            : eb(fieldRef, 'like', sql.val(`%${value}%`)),
                    )
                    .with('startsWith', () =>
                        mode === 'insensitive'
                            ? eb(fieldRef, 'ilike', sql.val(`${value}%`))
                            : eb(fieldRef, 'like', sql.val(`${value}%`)),
                    )
                    .with('endsWith', () =>
                        mode === 'insensitive'
                            ? eb(fieldRef, 'ilike', sql.val(`%${value}`))
                            : eb(fieldRef, 'like', sql.val(`%${value}`)),
                    )
                    .otherwise(() => {
                        throw new QueryError(`Invalid string filter key: ${key}`);
                    });

                if (condition) {
                    conditions.push(condition);
                }
            }
        }

        return this.and(eb, ...conditions);
    }

    private prepStringCasing(
        eb: ExpressionBuilder<any, any>,
        value: unknown,
        mode: 'default' | 'insensitive' | undefined,
    ): any {
        if (!mode || mode === 'default') {
            return value === null ? value : sql.val(value);
        }

        if (typeof value === 'string') {
            return eb.fn('lower', [sql.val(value)]);
        } else if (Array.isArray(value)) {
            return value.map((v) => this.prepStringCasing(eb, v, mode));
        } else {
            return value === null ? null : sql.val(value);
        }
    }

    private buildNumberFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        type: BuiltinType,
        payload: any,
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            type,
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, type, false),
            (value) => this.buildNumberFilter(eb, fieldRef, type, value),
        );
        return this.and(eb, ...conditions);
    }

    private buildBooleanFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        payload: BooleanFilter<Schema, boolean, boolean>,
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            'Boolean',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'Boolean', false),
            (value) => this.buildBooleanFilter(eb, fieldRef, value as BooleanFilter<Schema, boolean, boolean>),
            true,
            ['equals', 'not'],
        );
        return this.and(eb, ...conditions);
    }

    private buildDateTimeFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        payload: DateTimeFilter<Schema, boolean, boolean>,
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            'DateTime',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'DateTime', false),
            (value) => this.buildDateTimeFilter(eb, fieldRef, value as DateTimeFilter<Schema, boolean, boolean>),
            true,
        );
        return this.and(eb, ...conditions);
    }

    private buildBytesFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        payload: BytesFilter<Schema, boolean, boolean>,
    ) {
        const conditions = this.buildStandardFilter(
            eb,
            'Bytes',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'Bytes', false),
            (value) => this.buildBytesFilter(eb, fieldRef, value as BytesFilter<Schema, boolean, boolean>),
            true,
            ['equals', 'in', 'notIn', 'not'],
        );
        return this.and(eb, ...conditions.conditions);
    }

    private buildEnumFilter(
        eb: ExpressionBuilder<any, any>,
        fieldRef: Expression<any>,
        fieldDef: FieldDef,
        payload: any,
    ) {
        const conditions = this.buildStandardFilter(
            eb,
            'String',
            payload,
            fieldRef,
            (value) => value,
            (value) => this.buildEnumFilter(eb, fieldRef, fieldDef, value),
            true,
            ['equals', 'in', 'notIn', 'not'],
        );
        return this.and(eb, ...conditions.conditions);
    }

    buildOrderBy(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        modelAlias: string,
        orderBy: OrArray<OrderBy<Schema, GetModels<Schema>, boolean, boolean>> | undefined,
        useDefaultIfEmpty: boolean,
        negated: boolean,
    ) {
        if (!orderBy) {
            if (useDefaultIfEmpty) {
                orderBy = makeDefaultOrderBy(this.schema, model);
            } else {
                return query;
            }
        }

        let result = query;
        enumerate(orderBy).forEach((orderBy) => {
            for (const [field, value] of Object.entries<any>(orderBy)) {
                if (!value) {
                    continue;
                }

                // aggregations
                if (['_count', '_avg', '_sum', '_min', '_max'].includes(field)) {
                    invariant(value && typeof value === 'object', `invalid orderBy value for field "${field}"`);
                    for (const [k, v] of Object.entries<SortOrder>(value)) {
                        invariant(v === 'asc' || v === 'desc', `invalid orderBy value for field "${field}"`);
                        result = result.orderBy(
                            (eb) =>
                                aggregate(eb, this.fieldRef(model, k, eb, modelAlias), field as AGGREGATE_OPERATORS),
                            sql.raw(this.negateSort(v, negated)),
                        );
                    }
                    continue;
                }

                switch (field) {
                    case '_count': {
                        invariant(value && typeof value === 'object', 'invalid orderBy value for field "_count"');
                        for (const [k, v] of Object.entries<string>(value)) {
                            invariant(v === 'asc' || v === 'desc', `invalid orderBy value for field "${field}"`);
                            result = result.orderBy(
                                (eb) => eb.fn.count(this.fieldRef(model, k, eb, modelAlias)),
                                sql.raw(this.negateSort(v, negated)),
                            );
                        }
                        continue;
                    }
                    default:
                        break;
                }

                const fieldDef = requireField(this.schema, model, field);

                if (!fieldDef.relation) {
                    const fieldRef = this.fieldRef(model, field, expressionBuilder(), modelAlias);
                    if (value === 'asc' || value === 'desc') {
                        result = result.orderBy(fieldRef, this.negateSort(value, negated));
                    } else if (
                        value &&
                        typeof value === 'object' &&
                        'nulls' in value &&
                        'sort' in value &&
                        (value.sort === 'asc' || value.sort === 'desc') &&
                        (value.nulls === 'first' || value.nulls === 'last')
                    ) {
                        result = result.orderBy(
                            fieldRef,
                            sql.raw(`${this.negateSort(value.sort, negated)} nulls ${value.nulls}`),
                        );
                    }
                } else {
                    // order by relation
                    const relationModel = fieldDef.type;

                    if (fieldDef.array) {
                        // order by to-many relation
                        if (typeof value !== 'object') {
                            throw new QueryError(`invalid orderBy value for field "${field}"`);
                        }
                        if ('_count' in value) {
                            invariant(
                                value._count === 'asc' || value._count === 'desc',
                                'invalid orderBy value for field "_count"',
                            );
                            const sort = this.negateSort(value._count, negated);
                            result = result.orderBy((eb) => {
                                const subQueryAlias = `${modelAlias}$orderBy$${field}$count`;
                                let subQuery = this.buildSelectModel(eb, relationModel, subQueryAlias);
                                const joinPairs = buildJoinPairs(this.schema, model, modelAlias, field, subQueryAlias);
                                subQuery = subQuery.where(() =>
                                    this.and(
                                        eb,
                                        ...joinPairs.map(([left, right]) => eb(sql.ref(left), '=', sql.ref(right))),
                                    ),
                                );
                                subQuery = subQuery.select(() => eb.fn.count(eb.lit(1)).as('_count'));
                                return subQuery;
                            }, sort);
                        }
                    } else {
                        // order by to-one relation
                        result = result.leftJoin(relationModel, (join) => {
                            const joinPairs = buildJoinPairs(this.schema, model, modelAlias, field, relationModel);
                            return join.on((eb) =>
                                this.and(
                                    eb,
                                    ...joinPairs.map(([left, right]) => eb(sql.ref(left), '=', sql.ref(right))),
                                ),
                            );
                        });
                        result = this.buildOrderBy(result, fieldDef.type, relationModel, value, false, negated);
                    }
                }
            }
        });

        return result;
    }

    buildSelectAllFields(
        model: string,
        query: SelectQueryBuilder<any, any, any>,
        omit: Record<string, boolean | undefined> | undefined,
        modelAlias: string,
    ) {
        const modelDef = requireModel(this.schema, model);
        let result = query;

        for (const field of Object.keys(modelDef.fields)) {
            if (isRelationField(this.schema, model, field)) {
                continue;
            }
            if (omit?.[field] === true) {
                continue;
            }
            result = this.buildSelectField(result, model, modelAlias, field);
        }

        // select all fields from delegate descendants and pack into a JSON field `$delegate$Model`
        const descendants = getDelegateDescendantModels(this.schema, model);
        for (const subModel of descendants) {
            result = this.buildDelegateJoin(model, modelAlias, subModel.name, result);
            result = result.select((eb) => {
                const jsonObject: Record<string, Expression<any>> = {};
                for (const field of Object.keys(subModel.fields)) {
                    if (
                        isRelationField(this.schema, subModel.name, field) ||
                        isInheritedField(this.schema, subModel.name, field)
                    ) {
                        continue;
                    }
                    jsonObject[field] = eb.ref(`${subModel.name}.${field}`);
                }
                return this.buildJsonObject(eb, jsonObject).as(`${DELEGATE_JOINED_FIELD_PREFIX}${subModel.name}`);
            });
        }

        return result;
    }

    protected buildModelSelect(
        eb: ExpressionBuilder<any, any>,
        model: GetModels<Schema>,
        subQueryAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        selectAllFields: boolean,
    ) {
        let subQuery = this.buildSelectModel(eb, model, subQueryAlias);

        if (selectAllFields) {
            subQuery = this.buildSelectAllFields(
                model,
                subQuery,
                typeof payload === 'object' ? payload?.omit : undefined,
                subQueryAlias,
            );
        }

        if (payload && typeof payload === 'object') {
            subQuery = this.buildFilterSortTake(model, payload, subQuery, subQueryAlias);
        }

        return subQuery;
    }

    buildSelectField(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        modelAlias: string,
        field: string,
    ): SelectQueryBuilder<any, any, any> {
        const fieldDef = requireField(this.schema, model, field);
        if (fieldDef.computed) {
            // TODO: computed field from delegate base?
            return query.select((eb) => this.fieldRef(model, field, eb, modelAlias).as(field));
        } else if (!fieldDef.originModel) {
            // regular field
            return query.select(sql.ref(`${modelAlias}.${field}`).as(field));
        } else {
            return this.buildSelectField(query, fieldDef.originModel, fieldDef.originModel, field);
        }
    }

    buildDelegateJoin(
        thisModel: string,
        thisModelAlias: string,
        otherModelAlias: string,
        query: SelectQueryBuilder<any, any, any>,
    ) {
        const idFields = getIdFields(this.schema, thisModel);
        query = query.leftJoin(otherModelAlias, (qb) => {
            for (const idField of idFields) {
                qb = qb.onRef(`${thisModelAlias}.${idField}`, '=', `${otherModelAlias}.${idField}`);
            }
            return qb;
        });
        return query;
    }

    buildCountJson(model: string, eb: ExpressionBuilder<any, any>, parentAlias: string, payload: any) {
        const modelDef = requireModel(this.schema, model);
        const toManyRelations = Object.entries(modelDef.fields).filter(([, field]) => field.relation && field.array);

        const selections =
            payload === true
                ? {
                      select: toManyRelations.reduce(
                          (acc, [field]) => {
                              acc[field] = true;
                              return acc;
                          },
                          {} as Record<string, boolean>,
                      ),
                  }
                : payload;

        const jsonObject: Record<string, Expression<any>> = {};

        for (const [field, value] of Object.entries(selections.select)) {
            const fieldDef = requireField(this.schema, model, field);
            const fieldModel = fieldDef.type;
            const joinPairs = buildJoinPairs(this.schema, model, parentAlias, field, fieldModel);

            // build a nested query to count the number of records in the relation
            let fieldCountQuery = eb.selectFrom(fieldModel).select(eb.fn.countAll().as(`_count$${field}`));

            // join conditions
            for (const [left, right] of joinPairs) {
                fieldCountQuery = fieldCountQuery.whereRef(left, '=', right);
            }

            // merge _count filter
            if (
                value &&
                typeof value === 'object' &&
                'where' in value &&
                value.where &&
                typeof value.where === 'object'
            ) {
                const filter = this.buildFilter(eb, fieldModel, fieldModel, value.where);
                fieldCountQuery = fieldCountQuery.where(filter);
            }

            jsonObject[field] = fieldCountQuery;
        }

        return this.buildJsonObject(eb, jsonObject);
    }

    // #endregion

    // #region utils

    private negateSort(sort: SortOrder, negated: boolean) {
        return negated ? (sort === 'asc' ? 'desc' : 'asc') : sort;
    }

    public true(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(this.transformPrimitive(true, 'Boolean', false) as boolean);
    }

    public false(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(this.transformPrimitive(false, 'Boolean', false) as boolean);
    }

    public isTrue(expression: Expression<SqlBool>) {
        const node = expression.toOperationNode();
        if (node.kind !== 'ValueNode') {
            return false;
        }
        return (node as ValueNode).value === true || (node as ValueNode).value === 1;
    }

    public isFalse(expression: Expression<SqlBool>) {
        const node = expression.toOperationNode();
        if (node.kind !== 'ValueNode') {
            return false;
        }
        return (node as ValueNode).value === false || (node as ValueNode).value === 0;
    }

    protected and(eb: ExpressionBuilder<any, any>, ...args: Expression<SqlBool>[]) {
        const nonTrueArgs = args.filter((arg) => !this.isTrue(arg));
        if (nonTrueArgs.length === 0) {
            return this.true(eb);
        } else if (nonTrueArgs.length === 1) {
            return nonTrueArgs[0]!;
        } else {
            return eb.and(nonTrueArgs);
        }
    }

    protected or(eb: ExpressionBuilder<any, any>, ...args: Expression<SqlBool>[]) {
        const nonFalseArgs = args.filter((arg) => !this.isFalse(arg));
        if (nonFalseArgs.length === 0) {
            return this.false(eb);
        } else if (nonFalseArgs.length === 1) {
            return nonFalseArgs[0]!;
        } else {
            return eb.or(nonFalseArgs);
        }
    }

    protected not(eb: ExpressionBuilder<any, any>, ...args: Expression<SqlBool>[]) {
        return eb.not(this.and(eb, ...args));
    }

    fieldRef(
        model: string,
        field: string,
        eb: ExpressionBuilder<any, any>,
        modelAlias?: string,
        inlineComputedField = true,
    ) {
        return buildFieldRef(this.schema, model, field, this.options, eb, modelAlias, inlineComputedField);
    }

    protected canJoinWithoutNestedSelect(
        modelDef: ModelDef,
        payload: boolean | FindArgs<Schema, GetModels<Schema>, true>,
    ) {
        if (modelDef.computedFields) {
            // computed fields requires explicit select
            return false;
        }

        if (modelDef.baseModel || modelDef.isDelegate) {
            // delegate models require upward/downward joins
            return false;
        }

        if (
            typeof payload === 'object' &&
            (payload.orderBy ||
                payload.skip !== undefined ||
                payload.take !== undefined ||
                payload.cursor ||
                (payload as any).distinct)
        ) {
            // ordering/pagination/distinct needs to be handled before joining
            return false;
        }

        return true;
    }

    // #endregion

    // #region abstract methods

    abstract get provider(): DataSourceProviderType;

    /**
     * Builds selection for a relation field.
     */
    abstract buildRelationSelection(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ): SelectQueryBuilder<any, any, any>;

    /**
     * Builds skip and take clauses.
     */
    abstract buildSkipTake(
        query: SelectQueryBuilder<any, any, any>,
        skip: number | undefined,
        take: number | undefined,
    ): SelectQueryBuilder<any, any, any>;

    /**
     * Builds an Kysely expression that returns a JSON object for the given key-value pairs.
     */
    abstract buildJsonObject(
        eb: ExpressionBuilder<any, any>,
        value: Record<string, Expression<unknown>>,
    ): ExpressionWrapper<any, any, unknown>;

    /**
     * Builds an Kysely expression that returns the length of an array.
     */
    abstract buildArrayLength(
        eb: ExpressionBuilder<any, any>,
        array: Expression<unknown>,
    ): ExpressionWrapper<any, any, number>;

    /**
     * Builds an array literal SQL string for the given values.
     */
    abstract buildArrayLiteralSQL(values: unknown[]): string;

    /**
     * Whether the dialect supports updating with a limit on the number of updated rows.
     */
    abstract get supportsUpdateWithLimit(): boolean;

    /**
     * Whether the dialect supports deleting with a limit on the number of deleted rows.
     */
    abstract get supportsDeleteWithLimit(): boolean;

    /**
     * Whether the dialect supports DISTINCT ON.
     */
    abstract get supportsDistinctOn(): boolean;

    /**
     * Whether the dialect support inserting with `DEFAULT` as field value.
     */
    abstract get supportInsertWithDefault(): boolean;

    // #endregion
}
