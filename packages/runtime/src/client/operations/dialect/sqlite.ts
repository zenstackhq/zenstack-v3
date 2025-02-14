import type { ExpressionBuilder, RawBuilder } from 'kysely';
import { ExpressionWrapper, sql, type SelectQueryBuilder } from 'kysely';
import type { QueryDialect } from '.';
import type { BuiltinType, SchemaDef } from '../../../schema/schema';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import type { SelectInclude } from '../../types';

export class SqliteQueryDialect implements QueryDialect {
    transformPrimitive(value: unknown, type: BuiltinType) {
        if (value === undefined) {
            return value;
        }
        if (type === 'Boolean') {
            return value ? 1 : 0;
        } else {
            return value;
        }
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

        return query.select((eb) =>
            this.buildRelationJSON(
                eb,
                schema,
                model,
                relationField,
                parentName,
                payload
            ).as(relationField)
        );
    }

    private buildRelationJSON(
        eb: ExpressionBuilder<any, any>,
        schema: SchemaDef,
        model: string,
        relationField: string,
        parentName: string,
        payload: true | SelectInclude<SchemaDef, string>
    ) {
        const relationFieldDef = requireField(schema, model, relationField);
        const relationModel = relationFieldDef.type;
        const relationModelDef = requireModel(schema, relationModel);

        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
            schema,
            model,
            relationField
        );

        let tbl = eb
            .selectFrom(
                `${relationModelDef.dbTable} as ${parentName}$${relationField}`
            )
            .select((eb1) => {
                const objArgs: Array<
                    | string
                    | ExpressionWrapper<any, any, any>
                    | RawBuilder<any>
                    | SelectQueryBuilder<any, any, {}>
                > = [];

                if (payload === true || !payload.select) {
                    // select all scalar fields
                    objArgs.push(
                        ...Object.entries(relationModelDef.fields)
                            .filter(([, value]) => !value.relation)
                            .map(([field]) => [sql.lit(field), eb1.ref(field)])
                            .flatMap((v) => v)
                    );
                } else if (payload.select) {
                    // select specific fields
                    objArgs.push(
                        ...Object.entries(payload.select)
                            .filter(([, value]) => value)
                            .map(([field]) => [sql.lit(field), eb1.ref(field)])
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
                                    eb1,
                                    schema,
                                    relationModel,
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
}
