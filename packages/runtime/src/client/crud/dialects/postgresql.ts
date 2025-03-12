import {
    sql,
    type ExpressionBuilder,
    type ExpressionWrapper,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import { match } from 'ts-pattern';
import type { SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef, GetModels } from '../../../schema/schema';
import type { FindArgs } from '../../client-types';
import { buildFieldRef, requireField, requireModel } from '../../query-utils';
import { BaseCrudDialect } from './base';

export class PostgresCrudDialect<
    Schema extends SchemaDef
> extends BaseCrudDialect<Schema> {
    override transformPrimitive(value: unknown, type: BuiltinType) {
        return match(type)
            .with('DateTime', () =>
                value instanceof Date
                    ? value
                    : typeof value === 'string'
                    ? new Date(value)
                    : value
            )
            .otherwise(() => value);
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
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

                // simple select by default
                let result = eb.selectFrom(
                    `${relationModelDef.dbTable} as ${joinTableName}`
                );

                // however if there're filter/orderBy/take/skip,
                // we need to build a subquery to handle them before aggregation
                if (payload && typeof payload === 'object') {
                    result = eb.selectFrom(() => {
                        let subQuery = eb
                            .selectFrom(`${relationModelDef.dbTable}`)
                            .selectAll();

                        if (payload.where) {
                            subQuery = subQuery.where((eb) =>
                                this.buildFilter(
                                    eb,
                                    relationModel,
                                    relationModelDef.dbTable,
                                    payload.where
                                )
                            );
                        }

                        subQuery = this.buildSkipTake(
                            subQuery,
                            payload.skip,
                            payload.take
                        );

                        if (payload.orderBy) {
                            subQuery = this.buildOrderBy(
                                subQuery,
                                relationModel,
                                relationModelDef.dbTable,
                                payload.orderBy
                            );
                        }
                        return subQuery.as(joinTableName);
                    });
                }

                result = this.buildRelationObjectSelect(
                    relationModel,
                    relationField,
                    relationFieldDef,
                    result,
                    payload,
                    parentName
                );

                // add join conditions
                const joinPairs = this.buildJoinPairs(
                    model,
                    parentName,
                    relationField,
                    joinTableName
                );
                result = result.where((eb) =>
                    this.and(
                        eb,
                        ...joinPairs.map(([left, right]) =>
                            eb(sql.ref(left), '=', sql.ref(right))
                        )
                    )
                );

                // add nested joins for each relation
                result = this.buildRelationJoins(
                    relationModel,
                    relationField,
                    result,
                    payload,
                    parentName
                );

                // alias the join table
                return result.as(joinTableName);
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
