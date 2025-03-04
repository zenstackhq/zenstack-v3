import { sql, type SelectQueryBuilder } from 'kysely';
import type { GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef } from '../../../schema/schema';
import type { ClientOptions } from '../../options';
import {
    getIdFields,
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

    buildWhere(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        table: string,
        where: Record<string, any> | undefined
    ) {
        let result = query;
        if (!where) {
            return result;
        }

        const modelDef = requireModel(this.schema, model);
        let hasRelationFilter = false;
        for (const [field, payload] of Object.entries(where)) {
            if (field.startsWith('$')) {
                continue;
            }

            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                result = this.buildRelationFilter(
                    result,
                    model,
                    field,
                    fieldDef,
                    payload
                );
                hasRelationFilter = true;
            } else {
                result = this.buildPrimitiveFilter(
                    result,
                    table,
                    field,
                    fieldDef,
                    payload
                );
            }
        }

        if (hasRelationFilter) {
            // group by id fields
            const idFields = getIdFields(this.schema, model);
            result = result.groupBy(
                idFields.map((field) => sql.ref(`${modelDef.dbTable}.${field}`))
            );
        }

        // call expression builder and combine the results
        if ('$expr' in where && typeof where['$expr'] === 'function') {
            result = result.where((eb) => where['$expr'](eb));
        }

        return result;
    }

    buildRelationFilter(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        const fieldModelDef = requireModel(this.schema, fieldDef.type);
        const fieldModelIdFields = getIdFields(this.schema, fieldDef.type);

        const relationKeyPairs = getRelationForeignKeyFieldPairs(
            this.schema,
            model,
            field
        );

        let result = query;

        result = result.leftJoin(fieldModelDef.dbTable, (join) => {
            for (const { fk, pk } of relationKeyPairs.keyPairs) {
                if (relationKeyPairs.ownedByModel) {
                    join = join.onRef(
                        sql.ref(`${model}.${fk}`),
                        '=',
                        sql.ref(`${fieldModelDef.dbTable}.${pk}`)
                    );
                } else {
                    join = join.onRef(
                        sql.ref(`${model}.${pk}`),
                        '=',
                        sql.ref(`${fieldModelDef.dbTable}.${fk}`)
                    );
                }
            }
            return join;
        });

        for (const [key, subPayload] of Object.entries(payload)) {
            if (!subPayload) {
                continue;
            }

            if (key === 'some') {
                result = this.buildWhere(
                    result,
                    fieldDef.type,
                    fieldModelDef.dbTable,
                    subPayload
                );
                result = result.having(
                    (eb) =>
                        eb.fn.count(
                            sql.ref(
                                `${
                                    fieldModelDef.dbTable
                                }.${fieldModelIdFields[0]!}`
                            )
                        ),
                    '>',
                    0
                );
            }
        }

        return result;
    }

    buildPrimitiveFilter(
        query: SelectQueryBuilder<any, any, {}>,
        table: string,
        field: string,
        fieldDef: FieldDef,
        payload: any
    ) {
        // TODO: non-equality filters
        return query.where(
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
