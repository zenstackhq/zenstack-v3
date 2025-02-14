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
    ModelDef,
    SchemaDef,
} from '../../../schema/schema';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import type { SelectInclude } from '../../types';

export class PostgresQueryDialect implements QueryDialect {
    transformPrimitive(value: unknown, _type: BuiltinType) {
        return value;
    }

    buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        schema: SchemaDef,
        model: string,
        relationField: string,
        parentName: string,
        payload: boolean | SelectInclude<SchemaDef, string>
    ): SelectQueryBuilder<any, any, {}> {
        if (payload === false) {
            // not selected
            return query;
        }

        const joinedQuery = this.buildRelationJSON(
            query,
            schema,
            model,
            relationField,
            parentName,
            payload
        );

        return joinedQuery.select(
            `${parentName}$${relationField}.data as ${relationField}`
        );
    }

    private buildRelationJSON(
        qb: SelectQueryBuilder<any, any, any>,
        schema: SchemaDef,
        model: string,
        relationField: string,
        parentName: string,
        payload: true | SelectInclude<SchemaDef, string>
    ) {
        const relationFieldDef = requireField(schema, model, relationField);
        const relationModel = relationFieldDef.type;
        const relationModelDef = requireModel(schema, relationModel);

        return (
            qb
                // .select(`${parentName}$${relationField}.data as ${relationField}`)
                .leftJoinLateral(
                    (eb) => {
                        let result = eb.selectFrom(
                            `${relationModelDef.dbTable} as ${parentName}$${relationField}`
                        );

                        result = this.buildRelationObjectSelect(
                            relationModelDef,
                            relationField,
                            relationFieldDef,
                            result,
                            payload,
                            parentName
                        );

                        // create join conditions
                        result = this.buildJoinConditions(
                            schema,
                            model,
                            relationField,
                            result,
                            parentName
                        );

                        // create nested joins for each relation
                        result = this.buildRelationJoins(
                            schema,
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
                )
        );
    }

    private buildRelationObjectSelect(
        relationModelDef: ModelDef,
        relationField: string,
        relationFieldDef: FieldDef,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | SelectInclude<SchemaDef, string>,
        parentName: string
    ) {
        qb = qb.select((eb) => {
            const objArgs = this.buildRelationObjectArgs(
                relationModelDef,
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
        relationModelDef: ModelDef,
        relationField: string,
        eb: ExpressionBuilder<any, any>,
        payload: true | SelectInclude<SchemaDef, string>,
        parentName: string
    ) {
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
                    .map(([field]) => [sql.lit(field), eb.ref(field)])
                    .flatMap((v) => v)
            );
        } else if (payload.select) {
            // select specific fields
            objArgs.push(
                ...Object.entries(payload.select)
                    .filter(([, value]) => value)
                    .map(([field]) => [sql.lit(field), eb.ref(field)])
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
        schema: SchemaDef,
        relationModel: string,
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
                        result,
                        schema,
                        relationModel,
                        field,
                        `${parentName}$${relationField}`,
                        value
                    );
                });
        }
        return result;
    }

    private buildJoinConditions(
        schema: SchemaDef,
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
