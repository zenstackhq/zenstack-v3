import {
    sql,
    type Expression,
    type ExpressionBuilder,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import type { SchemaDef } from '../../../schema';
import type { BuiltinType, GetModels } from '../../../schema/schema';
import {
    buildFieldRef,
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import type { FindArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';
import { BaseCrudDialect } from './base';

export class SqliteCrudDialect<
    Schema extends SchemaDef
> extends BaseCrudDialect<Schema> {
    override transformPrimitive(value: unknown, type: BuiltinType) {
        if (value === undefined) {
            return value;
        }
        if (type === 'Boolean') {
            return value ? 1 : 0;
        } else {
            return value;
        }
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        operation: CrudOperation,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>
    ): SelectQueryBuilder<any, any, {}> {
        return query.select((eb) =>
            this.buildRelationJSON(
                model,
                operation,
                eb,
                relationField,
                parentAlias,
                payload
            ).as(relationField)
        );
    }

    private buildRelationJSON(
        model: string,
        operation: CrudOperation,
        eb: ExpressionBuilder<any, any>,
        relationField: string,
        parentName: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>
    ) {
        const relationFieldDef = requireField(
            this.schema,
            model,
            relationField
        );
        const relationModel = relationFieldDef.type as GetModels<Schema>;
        const relationModelDef = requireModel(this.schema, relationModel);

        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
            this.schema,
            model,
            relationField
        );

        const subQueryName = `${parentName}$${relationField}`;
        let tbl: SelectQueryBuilder<any, any, any> = eb
            .selectFrom(`${relationModelDef.dbTable} as ${subQueryName}`)
            .select((eb1) => {
                const objArgs: Array<
                    | Expression<any>
                    | RawBuilder<any>
                    | SelectQueryBuilder<any, any, {}>
                > = [];

                if (payload === true || !payload.select) {
                    // select all scalar fields
                    objArgs.push(
                        ...Object.entries(relationModelDef.fields)
                            .filter(([, value]) => !value.relation)
                            .map(([field]) => [
                                sql.lit(field),
                                buildFieldRef(
                                    this.schema,
                                    relationModel,
                                    field,
                                    this.options,
                                    eb1
                                ),
                            ])
                            .flatMap((v) => v)
                    );
                } else if (payload.select) {
                    // select specific fields
                    objArgs.push(
                        ...Object.entries(payload.select)
                            .filter(([, value]) => value)
                            .map(([field]) => [
                                sql.lit(field),
                                buildFieldRef(
                                    this.schema,
                                    relationModel,
                                    field,
                                    this.options,
                                    eb1
                                ),
                            ])
                            .flatMap((v) => v)
                    );
                }

                if (
                    typeof payload === 'object' &&
                    payload.include &&
                    typeof payload.include === 'object'
                ) {
                    // include relation fields
                    objArgs.push(
                        ...Object.entries<any>(payload.include)
                            .filter(([, value]) => value)
                            .map(([field, value]) => {
                                const subJson = this.buildRelationJSON(
                                    relationModel as GetModels<Schema>,
                                    operation,
                                    eb1,
                                    field,
                                    `${parentName}$${relationField}`,
                                    value
                                );
                                return [sql.lit(field), subJson];
                            })
                            .flatMap((v) => v)
                    );
                }

                if (relationFieldDef.array) {
                    return eb1.fn
                        .coalesce(
                            sql`json_group_array(json_object(${sql.join(
                                objArgs
                            )}))`,
                            sql`json_array()`
                        )
                        .as('data');
                } else {
                    return sql`json_object(${sql.join(objArgs)})`.as('data');
                }
            });

        if (typeof payload === 'object') {
            if (payload.where) {
                tbl = this.buildWhere(
                    tbl,
                    relationModel,
                    subQueryName,
                    payload.where
                );
            }
            if (payload.skip) {
                tbl = tbl.offset(payload.skip);
            }
            if (payload.take) {
                tbl = tbl.limit(payload.take);
            }
        }

        // join conditions
        keyPairs.forEach(({ fk, pk }) => {
            if (ownedByModel) {
                // the parent model owns the fk
                tbl = tbl.whereRef(
                    `${parentName}$${relationField}.${pk}`,
                    '=',
                    `${parentName}.${fk}`
                );
            } else {
                // the relation side owns the fk
                tbl = tbl.whereRef(
                    `${parentName}$${relationField}.${fk}`,
                    '=',
                    `${parentName}.${pk}`
                );
            }
        });
        return tbl;
    }

    override buildSkipTake(
        query: SelectQueryBuilder<any, any, {}>,
        skip: number | undefined,
        take: number | undefined
    ): SelectQueryBuilder<any, any, {}> {
        if (take !== undefined) {
            query = query.limit(take);
        }
        if (skip !== undefined) {
            query = query.offset(skip);
            if (take === undefined) {
                // SQLite requires offset to be used with limit
                query = query.limit(-1);
            }
        }
        return query;
    }
}
