import type { ExpressionBuilder } from 'kysely';
import {
    ExpressionWrapper,
    sql,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import type { QueryDialect } from '.';
import type {
    BuiltinType,
    FieldDef,
    GetModels,
    SchemaDef,
} from '../../../schema/schema';
import {
    buildFieldRef,
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import type { SelectInclude } from '../../types';
import type { OperationContext } from '../context';

export class PostgresQueryDialect implements QueryDialect {
    transformPrimitive(value: unknown, _type: BuiltinType) {
        return value;
    }

    buildRelationSelection<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        query: SelectQueryBuilder<any, any, {}>,
        relationField: string,
        parentName: string,
        payload: boolean | SelectInclude<Schema, GetModels<Schema>>
    ): SelectQueryBuilder<any, any, {}> {
        if (payload === false) {
            // not selected
            return query;
        }

        const joinedQuery = this.buildRelationJSON(
            context,
            query,
            relationField,
            parentName,
            payload
        );

        return joinedQuery.select(
            `${parentName}$${relationField}.data as ${relationField}`
        );
    }

    private buildRelationJSON<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        qb: SelectQueryBuilder<any, any, any>,
        relationField: string,
        parentName: string,
        payload: true | SelectInclude<Schema, GetModels<Schema>>
    ) {
        const relationFieldDef = requireField(
            context.schema,
            context.model,
            relationField
        );
        const relationModel = relationFieldDef.type;
        const relationModelDef = requireModel(context.schema, relationModel);

        return (
            qb
                // .select(`${parentName}$${relationField}.data as ${relationField}`)
                .leftJoinLateral(
                    (eb) => {
                        let result = eb.selectFrom(
                            `${relationModelDef.dbTable} as ${parentName}$${relationField}`
                        );

                        result = this.buildRelationObjectSelect(
                            context,
                            relationModel,
                            relationField,
                            relationFieldDef,
                            result,
                            payload,
                            parentName
                        );

                        // create join conditions
                        result = this.buildJoinConditions(
                            context.schema,
                            context.model,
                            relationField,
                            result,
                            parentName
                        );

                        // create nested joins for each relation
                        result = this.buildRelationJoins(
                            {
                                ...context,
                                model: relationModel as GetModels<Schema>,
                            },
                            relationField,
                            result,
                            payload,
                            parentName
                        );

                        // alias the join table
                        return result.as(`${parentName}$${relationField}`);
                    },
                    (join) => join.onTrue()
                )
        );
    }

    private buildRelationObjectSelect<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        relationModel: string,
        relationField: string,
        relationFieldDef: FieldDef,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | SelectInclude<Schema, GetModels<Schema>>,
        parentName: string
    ) {
        qb = qb.select((eb) => {
            const objArgs = this.buildRelationObjectArgs(
                { ...context, model: relationModel as GetModels<Schema> },
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

    private buildRelationObjectArgs<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        relationField: string,
        eb: ExpressionBuilder<any, any>,
        payload: true | SelectInclude<SchemaDef, string>,
        parentName: string
    ) {
        const relationModelDef = requireModel(context.schema, context.model);
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
                            context.schema,
                            context.model,
                            field,
                            context.clientOptions,
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
                            context.schema,
                            context.model,
                            field,
                            context.clientOptions,
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

    private buildRelationJoins<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        relationField: string,
        qb: SelectQueryBuilder<any, any, any>,
        payload: boolean | SelectInclude<SchemaDef, string>,
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
                        context,
                        result,
                        field,
                        `${parentName}$${relationField}`,
                        value
                    );
                });
        }
        return result;
    }

    private buildJoinConditions<Schema extends SchemaDef>(
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
