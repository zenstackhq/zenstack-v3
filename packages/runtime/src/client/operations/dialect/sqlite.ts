import { sql, type SelectQueryBuilder } from 'kysely';
import type { QueryDialect } from '.';
import type { SchemaDef } from '../../../schema/schema';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';

export class SqliteQueryDialect implements QueryDialect {
    buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        schema: SchemaDef,
        model: string,
        relationField: string,
        parentName: string,
        _payload: any
    ): SelectQueryBuilder<any, any, {}> {
        const relationFieldDef = requireField(schema, model, relationField);
        const relationModel = requireModel(schema, relationFieldDef.type);
        const keyPairs = getRelationForeignKeyFieldPairs(
            schema,
            model,
            relationField
        );

        let result = query;

        result = result.select((eb) => {
            let tbl = eb
                .selectFrom(
                    `${relationModel.dbTable} as ${parentName}$${relationField}`
                )
                .select((eb1) => {
                    const objArgs = Object.keys(relationModel.fields)
                        .filter((f) => !relationModel.fields[f]?.relation)
                        .map((field) => [field, eb1.ref(field)])
                        .flatMap((v) => v);

                    return eb1.fn
                        .coalesce(
                            sql`json_group_array(json_object(${sql.join(
                                objArgs
                            )}))`,
                            sql`json_array()`
                        )
                        .as('data');
                });
            keyPairs.forEach(({ fk, pk }) => {
                tbl = tbl.whereRef(
                    `${parentName}$${relationField}.${fk}`,
                    '=',
                    `${parentName}.${pk}`
                );
            });
            return tbl.as(relationField);
        });

        return result;
    }
}
