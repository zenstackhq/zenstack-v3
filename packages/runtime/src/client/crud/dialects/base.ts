import type { Expression, ExpressionBuilder, SqlBool, ValueNode } from 'kysely';
import { sql, type SelectQueryBuilder } from 'kysely';
import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef } from '../../../schema/schema';
import { enumerate } from '../../../utils/enumerate';
import { InternalError } from '../../errors';
import type { ClientOptions } from '../../options';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import type { FindArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';

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
        operation: CrudOperation,
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

        if (where === null) {
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
                    this.buildComposedFilter(eb, model, table, key, payload)
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

    protected buildComposedFilter(
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
                    this.buildComposedFilter(eb, model, table, 'AND', payload)
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
        // TODO: non-equality filters
        return eb(
            sql.ref(`${table}.${field}`),
            '=',
            this.transformPrimitive(payload, fieldDef.type as BuiltinType)
        );
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

    protected true(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(
            this.transformPrimitive(true, 'Boolean') as boolean
        );
    }

    protected false(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(
            this.transformPrimitive(false, 'Boolean') as boolean
        );
    }

    protected isTrue(expression: Expression<SqlBool>) {
        const node = expression.toOperationNode();
        if (node.kind !== 'ValueNode') {
            return false;
        }
        return (
            (node as ValueNode).value === true ||
            (node as ValueNode).value === 1
        );
    }

    protected isFalse(expression: Expression<SqlBool>) {
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
}
