import type { SelectQueryBuilder } from 'kysely';
import type { QueryDialect } from '.';
import type { SchemaDef } from '../../../schema/schema';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';

export class PostgresQueryDialect implements QueryDialect {
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

        result = result.leftJoinLateral(
            (eb) => {
                let tbl = eb.selectFrom(relationModel.dbTable);

                keyPairs.forEach(({ fk, pk }) => {
                    tbl = tbl.whereRef(
                        `${relationModel.dbTable}.${fk}`,
                        '=',
                        `${parentName}.${pk}`
                    );
                });

                return tbl
                    .select((eb1) =>
                        eb1.fn
                            .coalesce(
                                eb1.fn.jsonAgg(
                                    eb1.fn('jsonb_build_object', [])
                                ),
                                '[]'
                            )
                            .as('data')
                    )
                    .as(`${model}$${relationField}`);
            },
            (join) => join.onTrue()
        );

        result = result.select(
            `${model}$${relationField}.data as ${relationField}`
        );

        return result;
    }
}
