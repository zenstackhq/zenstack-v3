import {
    sql,
    type ExpressionBuilder,
    type ExpressionWrapper,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import type { SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef, GetModels } from '../../../schema/schema';
import { buildFieldRef, requireField, requireModel } from '../../query-utils';
import type { FindArgs } from '../../types';
import { type CrudOperation } from '../crud-handler';
import { BaseCrudDialect } from './base';

export class PostgresCrudDialect<
    Schema extends SchemaDef
> extends BaseCrudDialect<Schema> {
    override transformPrimitive(value: unknown, _type: BuiltinType) {
        return value;
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        _operation: CrudOperation,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>
    ): SelectQueryBuilder<any, any, {}> {
        const joinedQuery = this.buildRelationJSON(
            model,
            query,
            relationField,
            parentAlias,
            payload
        );

        return joinedQuery.select(
            `${parentAlias}$${relationField}.data as ${relationField}`
        );
    }

    private buildRelationJSON(
        model: string,
        qb: SelectQueryBuilder<any, any, any>,
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

        return qb.leftJoinLateral(
            (eb) => {
                const joinTableName = `${parentName}$${relationField}`;
                let result = eb.selectFrom(
                    `${relationModelDef.dbTable} as ${joinTableName}`
                );

                if (typeof payload === 'object' && payload.where) {
                    result = this.buildWhere(
                        result,
                        relationModel,
                        joinTableName,
                        payload.where
                    );
                }

                result = this.buildRelationObjectSelect(
                    relationModel,
                    relationField,
                    relationFieldDef,
                    result,
                    payload,
                    parentName
                );

                // create join conditions
                result = this.buildJoinConditions(
                    this.schema,
                    model,
                    relationField,
                    result,
                    parentName
                );

                // create nested joins for each relation
                result = this.buildRelationJoins(
                    relationModel,
                    relationField,
                    result,
                    payload,
                    parentName
                );

                // alias the join table
                return result.as(`${parentName}$${relationField}`);
            },
            (join) => join.onTrue()
        );
    }

    private buildRelationObjectSelect(
        relationModel: string,
        relationField: string,
        relationFieldDef: FieldDef,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string
    ) {
        qb = qb.select((eb) => {
            const objArgs = this.buildRelationObjectArgs(
                relationModel,
                relationField,
                eb,
                payload,
                parentName
            );

            if (relationFieldDef.array) {
                return eb.fn
                    .coalesce(
                        sql`jsonb_agg(jsonb_build_object(${sql.join(
                            objArgs
                        )}))`,
                        sql`'[]'::jsonb`
                    )
                    .as('data');
            } else {
                return sql`jsonb_build_object(${sql.join(objArgs)})`.as('data');
            }
        });

        return qb;
    }

    private buildRelationObjectArgs(
        relationModel: string,
        relationField: string,
        eb: ExpressionBuilder<any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string
    ) {
        const relationModelDef = requireModel(this.schema, relationModel);
        const objArgs: Array<
            | string
            | ExpressionWrapper<any, any, any>
            | SelectQueryBuilder<any, any, {}>
            | RawBuilder<any>
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
                            eb
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
                            eb
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
                    .map(([field]) => [
                        sql.lit(field),
                        eb.ref(`${parentName}$${relationField}$${field}.data`),
                    ])
                    .flatMap((v) => v)
            );
        }
        return objArgs;
    }

    private buildRelationJoins(
        model: string,
        relationField: string,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string
    ) {
        let result = qb;
        if (
            typeof payload === 'object' &&
            payload.include &&
            typeof payload.include === 'object'
        ) {
            Object.entries<any>(payload.include)
                .filter(([, value]) => value)
                .forEach(([field, value]) => {
                    result = this.buildRelationJSON(
                        model,
                        result,
                        field,
                        `${parentName}$${relationField}`,
                        value
                    );
                });
        }
        return result;
    }

    // private buildJoinConditions(
    //     schema: Schema,
    //     model: string,
    //     relationField: string,
    //     qb: SelectQueryBuilder<any, any, any>,
    //     parentName: string
    // ) {
    //     const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
    //         schema,
    //         model,
    //         relationField
    //     );

    //     keyPairs.forEach(({ fk, pk }) => {
    //         if (ownedByModel) {
    //             // the parent model owns the fk
    //             qb = qb.whereRef(
    //                 `${parentName}$${relationField}.${pk}`,
    //                 '=',
    //                 `${parentName}.${fk}`
    //             );
    //         } else {
    //             // the relation side owns the fk
    //             qb = qb.whereRef(
    //                 `${parentName}$${relationField}.${fk}`,
    //                 '=',
    //                 `${parentName}.${pk}`
    //             );
    //         }
    //     });
    //     return qb;
    // }

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
        }
        return query;
    }
}
