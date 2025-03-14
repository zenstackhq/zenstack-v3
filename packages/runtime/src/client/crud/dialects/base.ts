import type { Expression, ExpressionBuilder, SqlBool, ValueNode } from 'kysely';
import { sql, type SelectQueryBuilder } from 'kysely';
import invariant from 'tiny-invariant';
import { match, P } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef } from '../../../schema/schema';
import { enumerate } from '../../../utils/enumerate';
import { isPlainObject } from '../../../utils/is-plain-object';
import type {
    BooleanFilter,
    DateTimeFilter,
    FindArgs,
    SortOrder,
    StringFilter,
} from '../../client-types';
import { InternalError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import {
    getRelationForeignKeyFieldPairs,
    isEnum,
    requireField,
    requireModel,
} from '../../query-utils';

export abstract class BaseCrudDialect<Schema extends SchemaDef> {
    constructor(
        protected readonly schema: Schema,
        protected readonly options: ClientOptions<Schema>
    ) {}

    transformPrimitive(value: unknown, _type: BuiltinType) {
        return value;
    }

    abstract buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>
    ): SelectQueryBuilder<any, any, {}>;

    abstract buildSkipTake(
        query: SelectQueryBuilder<any, any, {}>,
        skip: number | undefined,
        take: number | undefined
    ): SelectQueryBuilder<any, any, {}>;

    buildFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        where: Record<string, any> | undefined
    ) {
        let result = this.true(eb);

        if (where === undefined) {
            return result;
        }

        if (where === null || typeof where !== 'object') {
            throw new InternalError('impossible null as filter');
        }

        for (const [key, payload] of Object.entries(where)) {
            if (payload === undefined) {
                continue;
            }

            if (key.startsWith('$')) {
                continue;
            }

            if (key === 'AND' || key === 'OR' || key === 'NOT') {
                result = this.and(
                    eb,
                    result,
                    this.buildCompositeFilter(eb, model, table, key, payload)
                );
                continue;
            }

            const fieldDef = requireField(this.schema, model, key);
            if (fieldDef.relation) {
                result = this.and(
                    eb,
                    result,
                    this.buildRelationFilter(
                        eb,
                        model,
                        table,
                        key,
                        fieldDef,
                        payload
                    )
                );
            } else {
                result = this.and(
                    eb,
                    result,
                    this.buildPrimitiveFilter(eb, table, key, fieldDef, payload)
                );
            }
        }

        // call expression builder and combine the results
        if ('$expr' in where && typeof where['$expr'] === 'function') {
            result = this.and(eb, result, where['$expr'](eb));
        }

        return result;
    }

    protected buildCompositeFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        key: 'AND' | 'OR' | 'NOT',
        payload: any
    ): Expression<SqlBool> {
        return match(key)
            .with('AND', () =>
                this.and(
                    eb,
                    ...enumerate(payload).map((subPayload) =>
                        this.buildFilter(eb, model, table, subPayload)
                    )
                )
            )
            .with('OR', () =>
                this.or(
                    eb,
                    ...enumerate(payload).map((subPayload) =>
                        this.buildFilter(eb, model, table, subPayload)
                    )
                )
            )
            .with('NOT', () =>
                eb.not(
                    this.buildCompositeFilter(eb, model, table, 'AND', payload)
                )
            )
            .exhaustive();
    }

    buildRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        if (!fieldDef.array) {
            return this.buildToOneRelationFilter(
                eb,
                model,
                table,
                field,
                fieldDef,
                payload
            );
        } else {
            return this.buildToManyRelationFilter(
                eb,
                model,
                table,
                field,
                fieldDef,
                payload
            );
        }
    }

    private buildToOneRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ): Expression<SqlBool> {
        if (payload === null) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                model,
                field
            );

            if (ownedByModel) {
                // can be short-circuited to FK null check
                return this.and(
                    eb,
                    ...keyPairs.map(({ fk }) =>
                        eb(sql.ref(`${table}.${fk}`), 'is', null)
                    )
                );
            } else {
                // translate it to `{ is: null }` filter
                return this.buildToOneRelationFilter(
                    eb,
                    model,
                    table,
                    field,
                    fieldDef,
                    { is: null }
                );
            }
        }

        const joinAlias = `${table}$${field}`;
        const joinPairs = this.buildJoinPairs(model, table, field, joinAlias);
        const filterResultField = `${field}$filter`;

        const joinSelect = eb
            .selectFrom(`${fieldDef.type} as ${joinAlias}`)
            .where(() =>
                this.and(
                    eb,
                    ...joinPairs.map(([left, right]) =>
                        eb(sql.ref(left), '=', sql.ref(right))
                    )
                )
            )
            .select(() => eb.fn.count(eb.lit(1)).as(filterResultField));

        let conditions: Expression<SqlBool>[] = [];

        if ('is' in payload || 'isNot' in payload) {
            if ('is' in payload) {
                if (payload.is === null) {
                    // check if not found
                    conditions.push(eb(joinSelect, '=', 0));
                } else {
                    // check if found
                    conditions.push(
                        eb(
                            joinSelect.where(() =>
                                this.buildFilter(
                                    eb,
                                    fieldDef.type,
                                    joinAlias,
                                    payload.is
                                )
                            ),
                            '>',
                            0
                        )
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
                                joinSelect.where(() =>
                                    this.buildFilter(
                                        eb,
                                        fieldDef.type,
                                        joinAlias,
                                        payload.isNot
                                    )
                                ),
                                '=',
                                0
                            )
                        )
                    );
                }
            }
        } else {
            conditions.push(
                eb(
                    joinSelect.where(() =>
                        this.buildFilter(eb, fieldDef.type, joinAlias, payload)
                    ),
                    '>',
                    0
                )
            );
        }

        return this.and(eb, ...conditions);
    }

    private buildToManyRelationFilter(
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        const fieldModelDef = requireModel(this.schema, fieldDef.type);

        const relationKeyPairs = getRelationForeignKeyFieldPairs(
            this.schema,
            model,
            field
        );

        // null check needs to be converted to fk "is null" checks
        if (payload === null) {
            return eb(sql.ref(`${table}.${field}`), 'is', null);
        }

        const buildPkFkWhereRefs = (eb: ExpressionBuilder<any, any>) => {
            let r = this.true(eb);
            for (const { fk, pk } of relationKeyPairs.keyPairs) {
                if (relationKeyPairs.ownedByModel) {
                    r = this.and(
                        eb,
                        r,
                        eb(
                            sql.ref(`${table}.${fk}`),
                            '=',
                            sql.ref(`${fieldModelDef.dbTable}.${pk}`)
                        )
                    );
                } else {
                    r = this.and(
                        eb,
                        r,
                        eb(
                            sql.ref(`${table}.${pk}`),
                            '=',
                            sql.ref(`${fieldModelDef.dbTable}.${fk}`)
                        )
                    );
                }
            }
            return r;
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
                            eb
                                .selectFrom(fieldModelDef.dbTable)
                                .select((eb1) =>
                                    eb1.fn.count(eb1.lit(1)).as('count')
                                )
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    this.buildFilter(
                                        eb1,
                                        fieldDef.type,
                                        fieldModelDef.dbTable,
                                        subPayload
                                    )
                                ),
                            '>',
                            0
                        )
                    );
                    break;
                }

                case 'every': {
                    result = this.and(
                        eb,
                        result,
                        eb(
                            eb
                                .selectFrom(fieldModelDef.dbTable)
                                .select((eb1) =>
                                    eb1.fn.count(eb1.lit(1)).as('count')
                                )
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    eb1.not(
                                        this.buildFilter(
                                            eb1,
                                            fieldDef.type,
                                            fieldModelDef.dbTable,
                                            subPayload
                                        )
                                    )
                                ),
                            '=',
                            0
                        )
                    );
                    break;
                }

                case 'none': {
                    result = this.and(
                        eb,
                        result,
                        eb(
                            eb
                                .selectFrom(fieldModelDef.dbTable)
                                .select((eb1) =>
                                    eb1.fn.count(eb1.lit(1)).as('count')
                                )
                                .where(buildPkFkWhereRefs(eb))
                                .where((eb1) =>
                                    this.buildFilter(
                                        eb1,
                                        fieldDef.type,
                                        fieldModelDef.dbTable,
                                        subPayload
                                    )
                                ),
                            '=',
                            0
                        )
                    );
                    break;
                }
            }
        }

        return result;
    }

    buildPrimitiveFilter(
        eb: ExpressionBuilder<any, any>,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        if (payload === null) {
            return eb(sql.ref(`${table}.${field}`), 'is', null);
        }

        if (isEnum(this.schema, fieldDef.type)) {
            return this.buildEnumFilter(eb, table, field, fieldDef, payload);
        }

        return match(fieldDef.type as BuiltinType)
            .with('String', () =>
                this.buildStringFilter(eb, table, field, payload)
            )
            .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                this.buildNumberFilter(eb, table, field, type, payload)
            )
            .with('Boolean', () =>
                this.buildBooleanFilter(eb, table, field, payload)
            )
            .with('DateTime', () =>
                this.buildDateTimeFilter(eb, table, field, payload)
            )
            .exhaustive();
    }

    private buildLiteralFilter(
        eb: ExpressionBuilder<any, any>,
        lhs: Expression<any>,
        type: BuiltinType,
        rhs: unknown
    ) {
        return eb(
            lhs,
            '=',
            rhs !== null && rhs !== undefined
                ? this.transformPrimitive(rhs, type)
                : rhs
        );
    }

    private buildStandardFilter(
        eb: ExpressionBuilder<any, any>,
        type: BuiltinType,
        payload: any,
        lhs: Expression<any>,
        getRhs: (value: unknown) => any,
        recurse: (value: unknown) => Expression<SqlBool>,
        throwIfInvalid = false,
        onlyForKeys: string[] | undefined = undefined
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
            const rhs = Array.isArray(value)
                ? value.map(getRhs)
                : getRhs(value);
            const condition = match(op)
                .with('equals', () =>
                    rhs === null ? eb(lhs, 'is', null) : eb(lhs, '=', rhs)
                )
                .with('in', () => {
                    invariant(Array.isArray(rhs));
                    if (rhs.length === 0) {
                        return this.false(eb);
                    } else {
                        return eb(lhs, 'in', rhs);
                    }
                })
                .with('notIn', () => {
                    invariant(Array.isArray(rhs));
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
        table: string,
        field: string,
        payload: StringFilter<true>
    ) {
        // if (typeof payload === 'string' || payload === null) {
        //     return this.buildLiteralFilter(eb, table, field, 'String', payload);
        // }

        // const conditions: Expression<SqlBool>[] = [];
        let fieldRef: Expression<any> = sql.ref(`${table}.${field}`);

        let insensitive = false;
        if (
            payload &&
            typeof payload === 'object' &&
            'mode' in payload &&
            payload.mode === 'insensitive'
        ) {
            insensitive = true;
            fieldRef = eb.fn('lower', [fieldRef]);
        }

        const { conditions, consumedKeys } = this.buildStandardFilter(
            eb,
            'String',
            payload,
            fieldRef,
            (value) => this.prepStringCasing(eb, value, insensitive),
            (value) =>
                this.buildStringFilter(
                    eb,
                    table,
                    field,
                    value as StringFilter<true>
                )
        );

        if (payload && typeof payload === 'object') {
            for (const [key, value] of Object.entries(payload)) {
                if (key === 'mode' || consumedKeys.includes(key)) {
                    // already consumed
                    continue;
                }

                const condition = match(key)
                    .with('contains', () =>
                        insensitive
                            ? eb(fieldRef, 'ilike', sql.lit(`%${value}%`))
                            : eb(fieldRef, 'like', sql.lit(`%${value}%`))
                    )
                    .with('startsWith', () =>
                        insensitive
                            ? eb(fieldRef, 'ilike', sql.lit(`${value}%`))
                            : eb(fieldRef, 'like', sql.lit(`${value}%`))
                    )
                    .with('endsWith', () =>
                        insensitive
                            ? eb(fieldRef, 'ilike', sql.lit(`%${value}`))
                            : eb(fieldRef, 'like', sql.lit(`%${value}`))
                    )
                    .otherwise(() => {
                        throw new Error(`Invalid string filter key: ${key}`);
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
        toLower: boolean = true
    ): any {
        if (typeof value === 'string') {
            return toLower ? eb.fn('lower', [sql.lit(value)]) : sql.lit(value);
        } else if (Array.isArray(value)) {
            return value.map((v) => this.prepStringCasing(eb, v, toLower));
        } else {
            return value === null ? null : sql.lit(value);
        }
    }

    private buildNumberFilter(
        eb: ExpressionBuilder<any, any>,
        table: string,
        field: string,
        type: BuiltinType,
        payload: any
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            type,
            payload,
            sql.ref(`${table}.${field}`),
            (value) => this.transformPrimitive(value, type),
            (value) => this.buildNumberFilter(eb, table, field, type, value)
        );
        return this.and(eb, ...conditions);
    }

    private buildBooleanFilter(
        eb: ExpressionBuilder<any, any>,
        table: string,
        field: string,
        payload: BooleanFilter<true>
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            'Boolean',
            payload,
            sql.ref(`${table}.${field}`),
            (value) => this.transformPrimitive(value, 'Boolean'),
            (value) =>
                this.buildBooleanFilter(
                    eb,
                    table,
                    field,
                    value as BooleanFilter<true>
                ),
            true,
            ['equals', 'not']
        );
        return this.and(eb, ...conditions);
    }

    private buildDateTimeFilter(
        eb: ExpressionBuilder<any, any>,
        table: string,
        field: string,
        payload: DateTimeFilter<true>
    ) {
        const { conditions } = this.buildStandardFilter(
            eb,
            'DateTime',
            payload,
            sql.ref(`${table}.${field}`),
            (value) => this.transformPrimitive(value, 'DateTime'),
            (value) =>
                this.buildDateTimeFilter(
                    eb,
                    table,
                    field,
                    value as DateTimeFilter<true>
                ),
            true
        );
        return this.and(eb, ...conditions);
    }

    private buildEnumFilter(
        eb: ExpressionBuilder<any, any>,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        const conditions = this.buildStandardFilter(
            eb,
            'String',
            payload,
            sql.ref(`${table}.${field}`),
            (value) => value,
            (value) => this.buildEnumFilter(eb, table, field, fieldDef, value),
            true,
            ['equals', 'in', 'notIn', 'not']
        );
        return this.and(eb, ...conditions.conditions);
    }

    protected buildJoinPairs(
        model: string,
        modelAlias: string,
        relationField: string,
        relationAlias: string
    ): [string, string][] {
        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
            this.schema,
            model,
            relationField
        );

        return keyPairs.map(({ fk, pk }) => {
            if (ownedByModel) {
                // the parent model owns the fk
                return [`${relationAlias}.${pk}`, `${modelAlias}.${fk}`];
            } else {
                // the relation side owns the fk
                return [`${relationAlias}.${fk}`, `${modelAlias}.${pk}`];
            }
        });
    }

    buildOrderBy(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        table: string,
        orderBy: NonNullable<
            FindArgs<Schema, GetModels<Schema>, true>['orderBy']
        >
    ) {
        let result = query;
        enumerate(orderBy).forEach((orderBy) => {
            for (const [field, value] of Object.entries(orderBy)) {
                if (!value) {
                    continue;
                }

                const fieldDef = requireField(this.schema, model, field);

                if (!fieldDef.relation) {
                    if (value === 'asc' || value === 'desc') {
                        result = result.orderBy(
                            sql.ref(`${table}.${field}`),
                            value
                        );
                    } else if (
                        value &&
                        typeof value === 'object' &&
                        'nulls' in value &&
                        'sort' in value &&
                        (value.sort === 'asc' || value.sort === 'desc') &&
                        (value.nulls === 'first' || value.nulls === 'last')
                    ) {
                        result = result.orderBy(
                            sql.ref(`${table}.${field}`),
                            sql.raw(`${value.sort} nulls ${value.nulls}`)
                        );
                    }
                } else {
                    // order by relation
                    const relationModelDef = requireModel(
                        this.schema,
                        fieldDef.type
                    );

                    if (fieldDef.array) {
                        // order by to-many relation
                        if (typeof value !== 'object') {
                            throw new QueryError(
                                `invalid orderBy value for field "${field}"`
                            );
                        }
                        if ('_count' in value) {
                            const sort = value._count;
                            result = result.orderBy((eb) => {
                                let subQuery = eb.selectFrom(
                                    relationModelDef.dbTable
                                );
                                const joinPairs = this.buildJoinPairs(
                                    model,
                                    table,
                                    field,
                                    relationModelDef.dbTable
                                );
                                subQuery = subQuery.where(() =>
                                    this.and(
                                        eb,
                                        ...joinPairs.map(([left, right]) =>
                                            eb(
                                                sql.ref(left),
                                                '=',
                                                sql.ref(right)
                                            )
                                        )
                                    )
                                );
                                subQuery = subQuery.select(() =>
                                    eb.fn.count(eb.lit(1)).as('_count')
                                );
                                return subQuery;
                            }, sort as SortOrder);
                        }
                    } else {
                        // order by to-one relation
                        result = result.leftJoin(
                            relationModelDef.dbTable,
                            (join) => {
                                const joinPairs = this.buildJoinPairs(
                                    model,
                                    table,
                                    field,
                                    relationModelDef.dbTable
                                );
                                return join.on((eb) =>
                                    this.and(
                                        eb,
                                        ...joinPairs.map(([left, right]) =>
                                            eb(
                                                sql.ref(left),
                                                '=',
                                                sql.ref(right)
                                            )
                                        )
                                    )
                                );
                            }
                        );
                        result = this.buildOrderBy(
                            result,
                            fieldDef.type,
                            relationModelDef.dbTable,
                            value
                        );
                    }
                }
            }
        });

        return result;
    }

    public true(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(
            this.transformPrimitive(true, 'Boolean') as boolean
        );
    }

    public false(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(
            this.transformPrimitive(false, 'Boolean') as boolean
        );
    }

    public isTrue(expression: Expression<SqlBool>) {
        const node = expression.toOperationNode();
        if (node.kind !== 'ValueNode') {
            return false;
        }
        return (
            (node as ValueNode).value === true ||
            (node as ValueNode).value === 1
        );
    }

    public isFalse(expression: Expression<SqlBool>) {
        const node = expression.toOperationNode();
        if (node.kind !== 'ValueNode') {
            return false;
        }
        return (
            (node as ValueNode).value === false ||
            (node as ValueNode).value === 0
        );
    }

    protected and(
        eb: ExpressionBuilder<any, any>,
        ...args: Expression<SqlBool>[]
    ) {
        const nonTrueArgs = args.filter((arg) => !this.isTrue(arg));
        if (nonTrueArgs.length === 0) {
            return this.true(eb);
        } else if (nonTrueArgs.length === 1) {
            return nonTrueArgs[0]!;
        } else {
            return eb.and(nonTrueArgs);
        }
    }

    protected or(
        eb: ExpressionBuilder<any, any>,
        ...args: Expression<SqlBool>[]
    ) {
        const nonFalseArgs = args.filter((arg) => !this.isFalse(arg));
        if (nonFalseArgs.length === 0) {
            return this.false(eb);
        } else if (nonFalseArgs.length === 1) {
            return nonFalseArgs[0]!;
        } else {
            return eb.or(nonFalseArgs);
        }
    }

    protected not(
        eb: ExpressionBuilder<any, any>,
        ...args: Expression<SqlBool>[]
    ) {
        return eb.not(this.and(eb, ...args));
    }

    get supportsUpdateWithLimit() {
        return true;
    }
}
