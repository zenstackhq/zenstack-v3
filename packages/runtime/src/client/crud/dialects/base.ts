import type { Expression, ExpressionBuilder, SqlBool, ValueNode } from 'kysely';
import { sql, type SelectQueryBuilder } from 'kysely';
import type { GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef } from '../../../schema/schema';
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
        // query: SelectQueryBuilder<any, any, {}>,
        eb: ExpressionBuilder<any, any>,
        model: string,
        table: string,
        where: Record<string, any> | undefined
    ) {
        let result = this.true(eb);
        if (!where) {
            return result;
        }

        for (const [field, payload] of Object.entries(where)) {
            if (field.startsWith('$')) {
                continue;
            }

            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                result = this.and(
                    eb,
                    result,
                    this.buildRelationFilter(
                        eb,
                        model,
                        table,
                        field,
                        fieldDef,
                        payload
                    )
                );
            } else {
                result = this.and(
                    eb,
                    result,
                    this.buildPrimitiveFilter(
                        eb,
                        table,
                        field,
                        fieldDef,
                        payload
                    )
                );
            }
        }

        // call expression builder and combine the results
        if ('$expr' in where && typeof where['$expr'] === 'function') {
            result = this.and(eb, result, where['$expr'](eb));
        }

        return result;
    }

    protected true(eb: ExpressionBuilder<any, any>): Expression<SqlBool> {
        return eb.lit<SqlBool>(
            this.transformPrimitive(true, 'Boolean') as boolean
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

    buildRelationFilter(
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

    protected buildJoinConditions(
        schema: Schema,
        model: string,
        relationField: string,
        qb: SelectQueryBuilder<any, any, any>,
        parentName: string
    ) {
        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
            schema,
            model,
            relationField
        );

        keyPairs.forEach(({ fk, pk }) => {
            if (ownedByModel) {
                // the parent model owns the fk
                qb = qb.whereRef(
                    `${parentName}$${relationField}.${pk}`,
                    '=',
                    `${parentName}.${fk}`
                );
            } else {
                // the relation side owns the fk
                qb = qb.whereRef(
                    `${parentName}$${relationField}.${fk}`,
                    '=',
                    `${parentName}.${pk}`
                );
            }
        });
        return qb;
    }
}
