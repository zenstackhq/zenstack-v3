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
    buildJoinPairs,
    ensureArray,
    flattenCompoundUniqueFilters,
    getDelegateDescendantModels,
    getManyToManyRelation,
    getRelationForeignKeyFieldPairs,
    isEnum,
    isInheritedField,
    isRelationField,
    makeDefaultOrderBy,
    requireField,
    requireIdFields,
    requireModel,
} from '../../query-utils';

export abstract class BaseCrudDialect<Schema extends SchemaDef> {
    protected eb = expressionBuilder<any, any>();

    constructor(
        protected readonly schema: Schema,
        protected readonly options: ClientOptions<Schema>,
    ) {}

    transformPrimitive(value: unknown, _type: BuiltinType, _forArrayField: boolean) {
        return value;
    }

    transformOutput(value: unknown, _type: BuiltinType) {
        return value;
    }

    // #region common query builders

    buildSelectModel(model: string, modelAlias: string) {
        const modelDef = requireModel(this.schema, model);
        let result = this.eb.selectFrom(model === modelAlias ? model : `${model} as ${modelAlias}`);
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
            result = result.where(() => this.buildFilter(model, modelAlias, args?.where));
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
        result = this.buildOrderBy(result, model, modelAlias, args.orderBy, negateOrderBy);

        // distinct
        if ('distinct' in args && (args as any).distinct) {
            const distinct = ensureArray((args as any).distinct) as string[];
            if (this.supportsDistinctOn) {
                result = result.distinctOn(distinct.map((f) => this.eb.ref(`${modelAlias}.${f}`)));
            } else {
                throw new QueryError(`"distinct" is not supported by "${this.schema.provider.type}" provider`);
            }
        }

        if (args.cursor) {
            result = this.buildCursorFilter(model, result, args.cursor, args.orderBy, negateOrderBy, modelAlias);
        }
        return result;
    }

    buildFilter(model: string, modelAlias: string, where: boolean | object | undefined) {
        if (where === true || where === undefined) {
            return this.true();
        }

        if (where === false) {
            return this.false();
        }

        let result = this.true();
        const _where = flattenCompoundUniqueFilters(this.schema, model, where);

        for (const [key, payload] of Object.entries(_where)) {
            if (payload === undefined) {
                continue;
            }

            if (key.startsWith('$')) {
                continue;
            }

            if (this.isLogicalCombinator(key)) {
                result = this.and(result, this.buildCompositeFilter(model, modelAlias, key, payload));
                continue;
            }

            const fieldDef = requireField(this.schema, model, key);

            if (fieldDef.relation) {
                result = this.and(result, this.buildRelationFilter(model, modelAlias, key, fieldDef, payload));
            } else {
                // if the field is from a base model, build a reference from that model
                const fieldRef = this.fieldRef(fieldDef.originModel ?? model, key, fieldDef.originModel ?? modelAlias);
                if (fieldDef.array) {
                    result = this.and(result, this.buildArrayFilter(fieldRef, fieldDef, payload));
                } else {
                    result = this.and(result, this.buildPrimitiveFilter(fieldRef, fieldDef, payload));
                }
            }
        }

        // call expression builder and combine the results
        if ('$expr' in _where && typeof _where['$expr'] === 'function') {
            result = this.and(result, _where['$expr'](this.eb));
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

        const subQueryAlias = `${model}$cursor$sub`;
        const cursorFilter = this.buildFilter(model, subQueryAlias, cursor);

        let result = query;
        const filters: ExpressionWrapper<any, any, any>[] = [];

        for (let i = orderByItems.length - 1; i >= 0; i--) {
            const andFilters: ExpressionWrapper<any, any, any>[] = [];

            for (let j = 0; j <= i; j++) {
                const [field, order] = orderByItems[j]!;
                const _order = negateOrderBy ? (order === 'asc' ? 'desc' : 'asc') : order;
                const op = j === i ? (_order === 'asc' ? '>=' : '<=') : '=';
                andFilters.push(
                    this.eb(
                        this.eb.ref(`${modelAlias}.${field}`),
                        op,
                        this.buildSelectModel(model, subQueryAlias)
                            .select(`${subQueryAlias}.${field}`)
                            .where(cursorFilter),
                    ),
                );
            }

            filters.push(this.eb.and(andFilters));
        }

        result = result.where((eb) => eb.or(filters));

        return result;
    }

    private isLogicalCombinator(key: string): key is (typeof LOGICAL_COMBINATORS)[number] {
        return LOGICAL_COMBINATORS.includes(key as any);
    }

    protected buildCompositeFilter(
        model: string,
        modelAlias: string,
        key: (typeof LOGICAL_COMBINATORS)[number],
        payload: any,
    ): Expression<SqlBool> {
        return match(key)
            .with('AND', () =>
                this.and(...enumerate(payload).map((subPayload) => this.buildFilter(model, modelAlias, subPayload))),
            )
            .with('OR', () =>
                this.or(...enumerate(payload).map((subPayload) => this.buildFilter(model, modelAlias, subPayload))),
            )
            .with('NOT', () => this.eb.not(this.buildCompositeFilter(model, modelAlias, 'AND', payload)))
            .exhaustive();
    }

    private buildRelationFilter(model: string, modelAlias: string, field: string, fieldDef: FieldDef, payload: any) {
        if (!fieldDef.array) {
            return this.buildToOneRelationFilter(model, modelAlias, field, fieldDef, payload);
        } else {
            return this.buildToManyRelationFilter(model, modelAlias, field, fieldDef, payload);
        }
    }

    private buildToOneRelationFilter(
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
                return this.and(...keyPairs.map(({ fk }) => this.eb(this.eb.ref(`${modelAlias}.${fk}`), 'is', null)));
            } else {
                // translate it to `{ is: null }` filter
                return this.buildToOneRelationFilter(model, modelAlias, field, fieldDef, { is: null });
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

        const joinSelect = this.eb
            .selectFrom(`${fieldDef.type} as ${joinAlias}`)
            .where(() =>
                this.and(...joinPairs.map(([left, right]) => this.eb(this.eb.ref(left), '=', this.eb.ref(right)))),
            )
            .select(() => this.eb.fn.count(this.eb.lit(1)).as(filterResultField));

        const conditions: Expression<SqlBool>[] = [];

        if ('is' in payload || 'isNot' in payload) {
            if ('is' in payload) {
                if (payload.is === null) {
                    // check if not found
                    conditions.push(this.eb(joinSelect, '=', 0));
                } else {
                    // check if found
                    conditions.push(
                        this.eb(
                            joinSelect.where(() => this.buildFilter(fieldDef.type, joinAlias, payload.is)),
                            '>',
                            0,
                        ),
                    );
                }
            }

            if ('isNot' in payload) {
                if (payload.isNot === null) {
                    // check if found
                    conditions.push(this.eb(joinSelect, '>', 0));
                } else {
                    conditions.push(
                        this.or(
                            // is null
                            this.eb(joinSelect, '=', 0),
                            // found one that matches the filter
                            this.eb(
                                joinSelect.where(() => this.buildFilter(fieldDef.type, joinAlias, payload.isNot)),
                                '=',
                                0,
                            ),
                        ),
                    );
                }
            }
        } else {
            conditions.push(
                this.eb(
                    joinSelect.where(() => this.buildFilter(fieldDef.type, joinAlias, payload)),
                    '>',
                    0,
                ),
            );
        }

        return this.and(...conditions);
    }

    private buildToManyRelationFilter(
        model: string,
        modelAlias: string,
        field: string,
        fieldDef: FieldDef,
        payload: any,
    ) {
        // null check needs to be converted to fk "is null" checks
        if (payload === null) {
            return this.eb(this.eb.ref(`${modelAlias}.${field}`), 'is', null);
        }

        const relationModel = fieldDef.type;

        // evaluating the filter involves creating an inner select,
        // give it an alias to avoid conflict
        const relationFilterSelectAlias = `${modelAlias}$${field}$filter`;

        const buildPkFkWhereRefs = (eb: ExpressionBuilder<any, any>) => {
            const m2m = getManyToManyRelation(this.schema, model, field);
            if (m2m) {
                // many-to-many relation

                const modelIdFields = requireIdFields(this.schema, model);
                invariant(modelIdFields.length === 1, 'many-to-many relation must have exactly one id field');
                const relationIdFields = requireIdFields(this.schema, relationModel);
                invariant(relationIdFields.length === 1, 'many-to-many relation must have exactly one id field');

                return eb(
                    this.eb.ref(`${relationFilterSelectAlias}.${relationIdFields[0]}`),
                    'in',
                    eb
                        .selectFrom(m2m.joinTable)
                        .select(`${m2m.joinTable}.${m2m.otherFkName}`)
                        .whereRef(
                            this.eb.ref(`${m2m.joinTable}.${m2m.parentFkName}`),
                            '=',
                            this.eb.ref(`${modelAlias}.${modelIdFields[0]}`),
                        ),
                );
            } else {
                const relationKeyPairs = getRelationForeignKeyFieldPairs(this.schema, model, field);

                let result = this.true();
                for (const { fk, pk } of relationKeyPairs.keyPairs) {
                    if (relationKeyPairs.ownedByModel) {
                        result = this.and(
                            result,
                            eb(
                                this.eb.ref(`${modelAlias}.${fk}`),
                                '=',
                                this.eb.ref(`${relationFilterSelectAlias}.${pk}`),
                            ),
                        );
                    } else {
                        result = this.and(
                            result,
                            eb(
                                this.eb.ref(`${modelAlias}.${pk}`),
                                '=',
                                this.eb.ref(`${relationFilterSelectAlias}.${fk}`),
                            ),
                        );
                    }
                }
                return result;
            }
        };

        let result = this.true();

        for (const [key, subPayload] of Object.entries(payload)) {
            if (!subPayload) {
                continue;
            }

            switch (key) {
                case 'some': {
                    result = this.and(
                        result,
                        this.eb(
                            this.buildSelectModel(relationModel, relationFilterSelectAlias)
                                .select(() => this.eb.fn.count(this.eb.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(this.eb))
                                .where(() => this.buildFilter(relationModel, relationFilterSelectAlias, subPayload)),
                            '>',
                            0,
                        ),
                    );
                    break;
                }

                case 'every': {
                    result = this.and(
                        result,
                        this.eb(
                            this.buildSelectModel(relationModel, relationFilterSelectAlias)
                                .select((eb1) => eb1.fn.count(eb1.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(this.eb))
                                .where(() =>
                                    this.eb.not(this.buildFilter(relationModel, relationFilterSelectAlias, subPayload)),
                                ),
                            '=',
                            0,
                        ),
                    );
                    break;
                }

                case 'none': {
                    result = this.and(
                        result,
                        this.eb(
                            this.buildSelectModel(relationModel, relationFilterSelectAlias)
                                .select(() => this.eb.fn.count(this.eb.lit(1)).as('$count'))
                                .where(buildPkFkWhereRefs(this.eb))
                                .where(() => this.buildFilter(relationModel, relationFilterSelectAlias, subPayload)),
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

    private buildArrayFilter(fieldRef: Expression<any>, fieldDef: FieldDef, payload: any) {
        const clauses: Expression<SqlBool>[] = [];
        const fieldType = fieldDef.type as BuiltinType;

        for (const [key, _value] of Object.entries(payload)) {
            if (_value === undefined) {
                continue;
            }

            const value = this.transformPrimitive(_value, fieldType, !!fieldDef.array);

            switch (key) {
                case 'equals': {
                    clauses.push(this.buildLiteralFilter(fieldRef, fieldType, this.eb.val(value)));
                    break;
                }

                case 'has': {
                    clauses.push(this.eb(fieldRef, '@>', this.eb.val([value])));
                    break;
                }

                case 'hasEvery': {
                    clauses.push(this.eb(fieldRef, '@>', this.eb.val(value)));
                    break;
                }

                case 'hasSome': {
                    clauses.push(this.eb(fieldRef, '&&', this.eb.val(value)));
                    break;
                }

                case 'isEmpty': {
                    clauses.push(this.eb(fieldRef, value === true ? '=' : '!=', this.eb.val([])));
                    break;
                }

                default: {
                    throw new InternalError(`Invalid array filter key: ${key}`);
                }
            }
        }

        return this.and(...clauses);
    }

    buildPrimitiveFilter(fieldRef: Expression<any>, fieldDef: FieldDef, payload: any) {
        if (payload === null) {
            return this.eb(fieldRef, 'is', null);
        }

        if (isEnum(this.schema, fieldDef.type)) {
            return this.buildEnumFilter(fieldRef, fieldDef, payload);
        }

        return (
            match(fieldDef.type as BuiltinType)
                .with('String', () => this.buildStringFilter(fieldRef, payload))
                .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                    this.buildNumberFilter(fieldRef, type, payload),
                )
                .with('Boolean', () => this.buildBooleanFilter(fieldRef, payload))
                .with('DateTime', () => this.buildDateTimeFilter(fieldRef, payload))
                .with('Bytes', () => this.buildBytesFilter(fieldRef, payload))
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

    private buildLiteralFilter(lhs: Expression<any>, type: BuiltinType, rhs: unknown) {
        return this.eb(lhs, '=', rhs !== null && rhs !== undefined ? this.transformPrimitive(rhs, type, false) : rhs);
    }

    private buildStandardFilter(
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
                conditions: [this.buildLiteralFilter(lhs, type, payload)],
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
                .with('equals', () => (rhs === null ? this.eb(lhs, 'is', null) : this.eb(lhs, '=', rhs)))
                .with('in', () => {
                    invariant(Array.isArray(rhs), 'right hand side must be an array');
                    if (rhs.length === 0) {
                        return this.false();
                    } else {
                        return this.eb(lhs, 'in', rhs);
                    }
                })
                .with('notIn', () => {
                    invariant(Array.isArray(rhs), 'right hand side must be an array');
                    if (rhs.length === 0) {
                        return this.true();
                    } else {
                        return this.eb.not(this.eb(lhs, 'in', rhs));
                    }
                })
                .with('lt', () => this.eb(lhs, '<', rhs))
                .with('lte', () => this.eb(lhs, '<=', rhs))
                .with('gt', () => this.eb(lhs, '>', rhs))
                .with('gte', () => this.eb(lhs, '>=', rhs))
                .with('not', () => this.eb.not(recurse(value)))
                // aggregations
                .with(P.union(...AGGREGATE_OPERATORS), (op) => {
                    const innerResult = this.buildStandardFilter(
                        type,
                        value,
                        aggregate(this.eb, lhs, op),
                        getRhs,
                        recurse,
                        throwIfInvalid,
                    );
                    consumedKeys.push(...innerResult.consumedKeys);
                    return this.and(...innerResult.conditions);
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

    private buildStringFilter(fieldRef: Expression<any>, payload: StringFilter<Schema, true, boolean>) {
        let mode: 'default' | 'insensitive' | undefined;
        if (payload && typeof payload === 'object' && 'mode' in payload) {
            mode = payload.mode;
        }

        const { conditions, consumedKeys } = this.buildStandardFilter(
            'String',
            payload,
            mode === 'insensitive' ? this.eb.fn('lower', [fieldRef]) : fieldRef,
            (value) => this.prepStringCasing(this.eb, value, mode),
            (value) => this.buildStringFilter(fieldRef, value as StringFilter<Schema, true, boolean>),
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
                            ? this.eb(fieldRef, 'ilike', sql.val(`%${value}%`))
                            : this.eb(fieldRef, 'like', sql.val(`%${value}%`)),
                    )
                    .with('startsWith', () =>
                        mode === 'insensitive'
                            ? this.eb(fieldRef, 'ilike', sql.val(`${value}%`))
                            : this.eb(fieldRef, 'like', sql.val(`${value}%`)),
                    )
                    .with('endsWith', () =>
                        mode === 'insensitive'
                            ? this.eb(fieldRef, 'ilike', sql.val(`%${value}`))
                            : this.eb(fieldRef, 'like', sql.val(`%${value}`)),
                    )
                    .otherwise(() => {
                        throw new QueryError(`Invalid string filter key: ${key}`);
                    });

                if (condition) {
                    conditions.push(condition);
                }
            }
        }

        return this.and(...conditions);
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

    private buildNumberFilter(fieldRef: Expression<any>, type: BuiltinType, payload: any) {
        const { conditions } = this.buildStandardFilter(
            type,
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, type, false),
            (value) => this.buildNumberFilter(fieldRef, type, value),
        );
        return this.and(...conditions);
    }

    private buildBooleanFilter(fieldRef: Expression<any>, payload: BooleanFilter<Schema, boolean, boolean>) {
        const { conditions } = this.buildStandardFilter(
            'Boolean',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'Boolean', false),
            (value) => this.buildBooleanFilter(fieldRef, value as BooleanFilter<Schema, boolean, boolean>),
            true,
            ['equals', 'not'],
        );
        return this.and(...conditions);
    }

    private buildDateTimeFilter(fieldRef: Expression<any>, payload: DateTimeFilter<Schema, boolean, boolean>) {
        const { conditions } = this.buildStandardFilter(
            'DateTime',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'DateTime', false),
            (value) => this.buildDateTimeFilter(fieldRef, value as DateTimeFilter<Schema, boolean, boolean>),
            true,
        );
        return this.and(...conditions);
    }

    private buildBytesFilter(fieldRef: Expression<any>, payload: BytesFilter<Schema, boolean, boolean>) {
        const conditions = this.buildStandardFilter(
            'Bytes',
            payload,
            fieldRef,
            (value) => this.transformPrimitive(value, 'Bytes', false),
            (value) => this.buildBytesFilter(fieldRef, value as BytesFilter<Schema, boolean, boolean>),
            true,
            ['equals', 'in', 'notIn', 'not'],
        );
        return this.and(...conditions.conditions);
    }

    private buildEnumFilter(fieldRef: Expression<any>, fieldDef: FieldDef, payload: any) {
        const conditions = this.buildStandardFilter(
            'String',
            payload,
            fieldRef,
            (value) => value,
            (value) => this.buildEnumFilter(fieldRef, fieldDef, value),
            true,
            ['equals', 'in', 'notIn', 'not'],
        );
        return this.and(...conditions.conditions);
    }

    buildOrderBy(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        modelAlias: string,
        orderBy: OrArray<OrderBy<Schema, GetModels<Schema>, boolean, boolean>> | undefined,
        negated: boolean,
    ) {
        if (!orderBy) {
            return query;
        }

        let result = query;

        const buildFieldRef = (model: string, field: string, modelAlias: string) => {
            const fieldDef = requireField(this.schema, model, field);
            return fieldDef.originModel
                ? this.fieldRef(fieldDef.originModel, field, fieldDef.originModel)
                : this.fieldRef(model, field, modelAlias);
        };

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
                            (eb) => aggregate(eb, buildFieldRef(model, k, modelAlias), field as AGGREGATE_OPERATORS),
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
                                (eb) => eb.fn.count(buildFieldRef(model, k, modelAlias)),
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
                    const fieldRef = buildFieldRef(model, field, modelAlias);
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
                                let subQuery = this.buildSelectModel(relationModel, subQueryAlias);
                                const joinPairs = buildJoinPairs(this.schema, model, modelAlias, field, subQueryAlias);
                                subQuery = subQuery.where(() =>
                                    this.and(
                                        ...joinPairs.map(([left, right]) =>
                                            eb(this.eb.ref(left), '=', this.eb.ref(right)),
                                        ),
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
                                    ...joinPairs.map(([left, right]) => eb(this.eb.ref(left), '=', this.eb.ref(right))),
                                ),
                            );
                        });
                        result = this.buildOrderBy(result, fieldDef.type, relationModel, value, negated);
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
                return this.buildJsonObject(jsonObject).as(`${DELEGATE_JOINED_FIELD_PREFIX}${subModel.name}`);
            });
        }

        return result;
    }

    protected buildModelSelect(
        model: GetModels<Schema>,
        subQueryAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        selectAllFields: boolean,
    ) {
        let subQuery = this.buildSelectModel(model, subQueryAlias);

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

        if (!fieldDef.originModel) {
            // field defined on this model
            return query.select(() => this.fieldRef(model, field, modelAlias).as(field));
        } else {
            // field defined on a delegate base, build a select with the origin model
            // name (the model is already joined from outer query)
            return this.buildSelectField(query, fieldDef.originModel, fieldDef.originModel, field);
        }
    }

    buildDelegateJoin(
        thisModel: string,
        thisModelAlias: string,
        otherModelAlias: string,
        query: SelectQueryBuilder<any, any, any>,
    ) {
        const idFields = requireIdFields(this.schema, thisModel);
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
            const fieldModel = fieldDef.type as GetModels<Schema>;
            let fieldCountQuery: SelectQueryBuilder<any, any, any>;

            // join conditions
            const m2m = getManyToManyRelation(this.schema, model, field);
            if (m2m) {
                // many-to-many relation, count the join table
                fieldCountQuery = this.buildModelSelect(fieldModel, fieldModel, value as any, false)
                    .innerJoin(m2m.joinTable, (join) =>
                        join
                            .onRef(`${m2m.joinTable}.${m2m.otherFkName}`, '=', `${fieldModel}.${m2m.otherPKName}`)
                            .onRef(`${m2m.joinTable}.${m2m.parentFkName}`, '=', `${parentAlias}.${m2m.parentPKName}`),
                    )
                    .select(eb.fn.countAll().as(`_count$${field}`));
            } else {
                // build a nested query to count the number of records in the relation
                fieldCountQuery = this.buildModelSelect(fieldModel, fieldModel, value as any, false).select(
                    eb.fn.countAll().as(`_count$${field}`),
                );

                // join conditions
                const joinPairs = buildJoinPairs(this.schema, model, parentAlias, field, fieldModel);
                for (const [left, right] of joinPairs) {
                    fieldCountQuery = fieldCountQuery.whereRef(left, '=', right);
                }
            }

            jsonObject[field] = fieldCountQuery;
        }

        return this.buildJsonObject(jsonObject);
    }

    // #endregion

    // #region utils

    private negateSort(sort: SortOrder, negated: boolean) {
        return negated ? (sort === 'asc' ? 'desc' : 'asc') : sort;
    }

    public true(): Expression<SqlBool> {
        return this.eb.lit<SqlBool>(this.transformPrimitive(true, 'Boolean', false) as boolean);
    }

    public false(): Expression<SqlBool> {
        return this.eb.lit<SqlBool>(this.transformPrimitive(false, 'Boolean', false) as boolean);
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

    and(...args: Expression<SqlBool>[]) {
        const nonTrueArgs = args.filter((arg) => !this.isTrue(arg));
        if (nonTrueArgs.length === 0) {
            return this.true();
        } else if (nonTrueArgs.length === 1) {
            return nonTrueArgs[0]!;
        } else {
            return this.eb.and(nonTrueArgs);
        }
    }

    or(...args: Expression<SqlBool>[]) {
        const nonFalseArgs = args.filter((arg) => !this.isFalse(arg));
        if (nonFalseArgs.length === 0) {
            return this.false();
        } else if (nonFalseArgs.length === 1) {
            return nonFalseArgs[0]!;
        } else {
            return this.eb.or(nonFalseArgs);
        }
    }

    not(...args: Expression<SqlBool>[]) {
        return this.eb.not(this.and(...args));
    }

    fieldRef(model: string, field: string, modelAlias?: string, inlineComputedField = true) {
        const fieldDef = requireField(this.schema, model, field);

        if (!fieldDef.computed) {
            // regular field
            return this.eb.ref(modelAlias ? `${modelAlias}.${field}` : field);
        } else {
            // computed field
            if (!inlineComputedField) {
                return this.eb.ref(modelAlias ? `${modelAlias}.${field}` : field);
            }
            let computer: Function | undefined;
            if ('computedFields' in this.options) {
                const computedFields = this.options.computedFields as Record<string, any>;
                computer = computedFields?.[fieldDef.originModel ?? model]?.[field];
            }
            if (!computer) {
                throw new QueryError(`Computed field "${field}" implementation not provided for model "${model}"`);
            }
            return computer(this.eb, { modelAlias });
        }
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
    abstract buildJsonObject(value: Record<string, Expression<unknown>>): ExpressionWrapper<any, any, unknown>;

    /**
     * Builds an Kysely expression that returns the length of an array.
     */
    abstract buildArrayLength(array: Expression<unknown>): ExpressionWrapper<any, any, number>;

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

    /**
     * Gets the SQL column type for the given field definition.
     */
    abstract getFieldSqlType(fieldDef: FieldDef): string;

    /*
     * Gets the string casing behavior for the dialect.
     */
    abstract getStringCasingBehavior(): { supportsILike: boolean; likeCaseSensitive: boolean };

    // #endregion
}
