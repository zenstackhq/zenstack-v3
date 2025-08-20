import { invariant } from '@zenstackhq/common-helpers';
import type Decimal from 'decimal.js';
import {
    ExpressionWrapper,
    sql,
    type Expression,
    type ExpressionBuilder,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import { match } from 'ts-pattern';
import type { BuiltinType, GetModels, SchemaDef } from '../../../schema';
import { DELEGATE_JOINED_FIELD_PREFIX } from '../../constants';
import type { FindArgs } from '../../crud-types';
import {
    getDelegateDescendantModels,
    getIdFields,
    getManyToManyRelation,
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModel,
} from '../../query-utils';
import { BaseCrudDialect } from './base';

export class SqliteCrudDialect<Schema extends SchemaDef> extends BaseCrudDialect<Schema> {
    override get provider() {
        return 'sqlite' as const;
    }

    override transformPrimitive(value: unknown, type: BuiltinType, _forArrayField: boolean): unknown {
        if (value === undefined) {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((v) => this.transformPrimitive(v, type, false));
        } else {
            if (this.schema.typeDefs && type in this.schema.typeDefs) {
                // typed JSON field
                return JSON.stringify(value);
            } else {
                return match(type)
                    .with('Boolean', () => (value ? 1 : 0))
                    .with('DateTime', () => (value instanceof Date ? value.toISOString() : value))
                    .with('Decimal', () => (value as Decimal).toString())
                    .with('Bytes', () => Buffer.from(value as Uint8Array))
                    .with('Json', () => JSON.stringify(value))
                    .otherwise(() => value);
            }
        }
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ): SelectQueryBuilder<any, any, any> {
        return query.select((eb) =>
            this.buildRelationJSON(model, eb, relationField, parentAlias, payload).as(relationField),
        );
    }

    private buildRelationJSON(
        model: string,
        eb: ExpressionBuilder<any, any>,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ) {
        const relationFieldDef = requireField(this.schema, model, relationField);
        const relationModel = relationFieldDef.type as GetModels<Schema>;
        const relationModelDef = requireModel(this.schema, relationModel);

        const subQueryName = `${parentAlias}$${relationField}`;

        let tbl = eb.selectFrom(() => {
            // give sub query an alias to avoid conflict with parent scope
            // (e.g., for cases like self-relation)
            const subQueryAlias = `${parentAlias}$${relationField}$sub`;
            let subQuery = this.buildSelectModel(eb, relationModel, subQueryAlias);

            subQuery = this.buildSelectAllFields(
                relationModel,
                subQuery,
                typeof payload === 'object' ? payload?.omit : undefined,
                subQueryAlias,
            );

            if (payload && typeof payload === 'object') {
                // take care of where, orderBy, skip, take, cursor, and distinct
                subQuery = this.buildFilterSortTake(relationModel, payload, subQuery, subQueryAlias);
            }

            // join conditions

            const m2m = getManyToManyRelation(this.schema, model, relationField);
            if (m2m) {
                // many-to-many relation
                const parentIds = getIdFields(this.schema, model);
                const relationIds = getIdFields(this.schema, relationModel);
                invariant(parentIds.length === 1, 'many-to-many relation must have exactly one id field');
                invariant(relationIds.length === 1, 'many-to-many relation must have exactly one id field');
                subQuery = subQuery.where(
                    eb(
                        eb.ref(`${subQueryAlias}.${relationIds[0]}`),
                        'in',
                        eb
                            .selectFrom(m2m.joinTable)
                            .select(`${m2m.joinTable}.${m2m.otherFkName}`)
                            .whereRef(`${parentAlias}.${parentIds[0]}`, '=', `${m2m.joinTable}.${m2m.parentFkName}`),
                    ),
                );
            } else {
                const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(this.schema, model, relationField);
                keyPairs.forEach(({ fk, pk }) => {
                    if (ownedByModel) {
                        // the parent model owns the fk
                        subQuery = subQuery.whereRef(`${subQueryAlias}.${pk}`, '=', `${parentAlias}.${fk}`);
                    } else {
                        // the relation side owns the fk
                        subQuery = subQuery.whereRef(`${subQueryAlias}.${fk}`, '=', `${parentAlias}.${pk}`);
                    }
                });
            }
            return subQuery.as(subQueryName);
        });

        tbl = tbl.select(() => {
            type ArgsType = Expression<any> | RawBuilder<any> | SelectQueryBuilder<any, any, any>;
            const objArgs: ArgsType[] = [];

            // TODO: descendant JSON shouldn't be joined and selected if none of its fields are selected
            const descendantModels = getDelegateDescendantModels(this.schema, relationModel);
            if (descendantModels.length > 0) {
                // select all JSONs built from delegate descendants
                objArgs.push(
                    ...descendantModels
                        .map((subModel) => [
                            sql.lit(`${DELEGATE_JOINED_FIELD_PREFIX}${subModel.name}`),
                            eb.ref(`${DELEGATE_JOINED_FIELD_PREFIX}${subModel.name}`),
                        ])
                        .flatMap((v) => v),
                );
            }

            if (payload === true || !payload.select) {
                // select all scalar fields
                objArgs.push(
                    ...Object.entries(relationModelDef.fields)
                        .filter(([, value]) => !value.relation)
                        .filter(([name]) => !(typeof payload === 'object' && (payload.omit as any)?.[name] === true))
                        .map(([field]) => [sql.lit(field), this.fieldRef(relationModel, field, eb, undefined, false)])
                        .flatMap((v) => v),
                );
            } else if (payload.select) {
                // select specific fields
                objArgs.push(
                    ...Object.entries<any>(payload.select)
                        .filter(([, value]) => value)
                        .map(([field, value]) => {
                            if (field === '_count') {
                                const subJson = this.buildCountJson(
                                    relationModel,
                                    eb,
                                    `${parentAlias}$${relationField}`,
                                    value,
                                );
                                return [sql.lit(field), subJson];
                            } else {
                                const fieldDef = requireField(this.schema, relationModel, field);
                                if (fieldDef.relation) {
                                    const subJson = this.buildRelationJSON(
                                        relationModel,
                                        eb,
                                        field,
                                        `${parentAlias}$${relationField}`,
                                        value,
                                    );
                                    return [sql.lit(field), subJson];
                                } else {
                                    return [
                                        sql.lit(field),
                                        this.fieldRef(relationModel, field, eb, undefined, false) as ArgsType,
                                    ];
                                }
                            }
                        })
                        .flatMap((v) => v),
                );
            }

            if (typeof payload === 'object' && payload.include && typeof payload.include === 'object') {
                // include relation fields
                objArgs.push(
                    ...Object.entries<any>(payload.include)
                        .filter(([, value]) => value)
                        .map(([field, value]) => {
                            const subJson = this.buildRelationJSON(
                                relationModel,
                                eb,
                                field,
                                `${parentAlias}$${relationField}`,
                                value,
                            );
                            return [sql.lit(field), subJson];
                        })
                        .flatMap((v) => v),
                );
            }

            if (relationFieldDef.array) {
                return eb.fn
                    .coalesce(sql`json_group_array(json_object(${sql.join(objArgs)}))`, sql`json_array()`)
                    .as('$j');
            } else {
                return sql`json_object(${sql.join(objArgs)})`.as('data');
            }
        });

        return tbl;
    }

    override buildSkipTake(
        query: SelectQueryBuilder<any, any, any>,
        skip: number | undefined,
        take: number | undefined,
    ) {
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

    override buildJsonObject(eb: ExpressionBuilder<any, any>, value: Record<string, Expression<unknown>>) {
        return eb.fn(
            'json_object',
            Object.entries(value).flatMap(([key, value]) => [sql.lit(key), value]),
        );
    }

    override get supportsUpdateWithLimit() {
        return false;
    }

    override get supportsDeleteWithLimit() {
        return false;
    }

    override get supportsDistinctOn() {
        return false;
    }

    override buildArrayLength(
        eb: ExpressionBuilder<any, any>,
        array: Expression<unknown>,
    ): ExpressionWrapper<any, any, number> {
        return eb.fn('json_array_length', [array]);
    }

    override buildArrayLiteralSQL(_values: unknown[]): string {
        throw new Error('SQLite does not support array literals');
    }

    override get supportInsertWithDefault() {
        return false;
    }
}
