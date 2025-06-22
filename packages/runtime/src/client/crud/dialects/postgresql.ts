import { invariant } from '@zenstackhq/sdk/local-helpers';
import {
    sql,
    type Expression,
    type ExpressionBuilder,
    type ExpressionWrapper,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import { match } from 'ts-pattern';
import type { BuiltinType, FieldDef, GetModels, SchemaDef } from '../../../schema';
import type { FindArgs } from '../../crud-types';
import {
    buildFieldRef,
    buildJoinPairs,
    getIdFields,
    getManyToManyRelation,
    requireField,
    requireModel,
} from '../../query-utils';
import { BaseCrudDialect } from './base';

export class PostgresCrudDialect<Schema extends SchemaDef> extends BaseCrudDialect<Schema> {
    override get provider() {
        return 'postgresql' as const;
    }

    override transformPrimitive(value: unknown, type: BuiltinType): unknown {
        if (value === undefined) {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((v) => this.transformPrimitive(v, type));
        } else {
            return match(type)
                .with('DateTime', () =>
                    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : value,
                )
                .otherwise(() => value);
        }
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ): SelectQueryBuilder<any, any, any> {
        const joinedQuery = this.buildRelationJSON(model, query, relationField, parentAlias, payload);

        return joinedQuery.select(`${parentAlias}$${relationField}.$j as ${relationField}`);
    }

    private buildRelationJSON(
        model: string,
        qb: SelectQueryBuilder<any, any, any>,
        relationField: string,
        parentName: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ) {
        const relationFieldDef = requireField(this.schema, model, relationField);
        const relationModel = relationFieldDef.type as GetModels<Schema>;

        return qb.leftJoinLateral(
            (eb) => {
                const joinTableName = `${parentName}$${relationField}`;

                // simple select by default
                let result = eb.selectFrom(`${relationModel} as ${joinTableName}`);

                // however if there're filter/orderBy/take/skip,
                // we need to build a subquery to handle them before aggregation
                result = eb.selectFrom(() => {
                    let subQuery = eb.selectFrom(`${relationModel}`).selectAll();

                    if (payload && typeof payload === 'object') {
                        if (payload.where) {
                            subQuery = subQuery.where((eb) =>
                                this.buildFilter(eb, relationModel, relationModel, payload.where),
                            );
                        }

                        // skip & take
                        const skip = payload.skip;
                        let take = payload.take;
                        let negateOrderBy = false;
                        if (take !== undefined && take < 0) {
                            negateOrderBy = true;
                            take = -take;
                        }
                        subQuery = this.buildSkipTake(subQuery, skip, take);

                        // orderBy
                        subQuery = this.buildOrderBy(
                            subQuery,
                            relationModel,
                            relationModel,
                            payload.orderBy,
                            skip !== undefined || take !== undefined,
                            negateOrderBy,
                        );
                    }

                    // add join conditions

                    const m2m = getManyToManyRelation(this.schema, model, relationField);

                    if (m2m) {
                        // many-to-many relation
                        const parentIds = getIdFields(this.schema, model);
                        const relationIds = getIdFields(this.schema, relationModel);
                        invariant(parentIds.length === 1, 'many-to-many relation must have exactly one id field');
                        invariant(relationIds.length === 1, 'many-to-many relation must have exactly one id field');
                        subQuery = subQuery.where(
                            eb(
                                eb.ref(`${relationModel}.${relationIds[0]}`),
                                'in',
                                eb
                                    .selectFrom(m2m.joinTable)
                                    .select(`${m2m.joinTable}.${m2m.otherFkName}`)
                                    .whereRef(
                                        `${parentName}.${parentIds[0]}`,
                                        '=',
                                        `${m2m.joinTable}.${m2m.parentFkName}`,
                                    ),
                            ),
                        );
                    } else {
                        const joinPairs = buildJoinPairs(this.schema, model, parentName, relationField, relationModel);
                        subQuery = subQuery.where((eb) =>
                            this.and(eb, ...joinPairs.map(([left, right]) => eb(sql.ref(left), '=', sql.ref(right)))),
                        );
                    }

                    return subQuery.as(joinTableName);
                });

                result = this.buildRelationObjectSelect(
                    relationModel,
                    relationField,
                    relationFieldDef,
                    result,
                    payload,
                    parentName,
                );

                // add nested joins for each relation
                result = this.buildRelationJoins(relationModel, relationField, result, payload, parentName);

                // alias the join table
                return result.as(joinTableName);
            },
            (join) => join.onTrue(),
        );
    }

    private buildRelationObjectSelect(
        relationModel: string,
        relationField: string,
        relationFieldDef: FieldDef,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string,
    ) {
        qb = qb.select((eb) => {
            const objArgs = this.buildRelationObjectArgs(relationModel, relationField, eb, payload, parentName);

            if (relationFieldDef.array) {
                return eb.fn
                    .coalesce(sql`jsonb_agg(jsonb_build_object(${sql.join(objArgs)}))`, sql`'[]'::jsonb`)
                    .as('$j');
            } else {
                return sql`jsonb_build_object(${sql.join(objArgs)})`.as('$j');
            }
        });

        return qb;
    }

    private buildRelationObjectArgs(
        relationModel: string,
        relationField: string,
        eb: ExpressionBuilder<any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string,
    ) {
        const relationModelDef = requireModel(this.schema, relationModel);
        const objArgs: Array<
            string | ExpressionWrapper<any, any, any> | SelectQueryBuilder<any, any, any> | RawBuilder<any>
        > = [];

        if (payload === true || !payload.select) {
            // select all scalar fields
            objArgs.push(
                ...Object.entries(relationModelDef.fields)
                    .filter(([, value]) => !value.relation)
                    .filter(([name]) => !(typeof payload === 'object' && (payload.omit as any)?.[name] === true))
                    .map(([field]) => [
                        sql.lit(field),
                        buildFieldRef(this.schema, relationModel, field, this.options, eb),
                    ])
                    .flatMap((v) => v),
            );
        } else if (payload.select) {
            // select specific fields
            objArgs.push(
                ...Object.entries(payload.select)
                    .filter(([, value]) => value)
                    .map(([field]) => [
                        sql.lit(field),
                        buildFieldRef(this.schema, relationModel, field, this.options, eb),
                    ])
                    .flatMap((v) => v),
            );
        }

        if (typeof payload === 'object' && payload.include && typeof payload.include === 'object') {
            // include relation fields
            objArgs.push(
                ...Object.entries<any>(payload.include)
                    .filter(([, value]) => value)
                    .map(([field]) => [sql.lit(field), eb.ref(`${parentName}$${relationField}$${field}.$j`)])
                    .flatMap((v) => v),
            );
        }
        return objArgs;
    }

    private buildRelationJoins(
        model: string,
        relationField: string,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentName: string,
    ) {
        let result = qb;
        if (typeof payload === 'object' && payload.include && typeof payload.include === 'object') {
            Object.entries<any>(payload.include)
                .filter(([, value]) => value)
                .forEach(([field, value]) => {
                    result = this.buildRelationJSON(model, result, field, `${parentName}$${relationField}`, value);
                });
        }
        return result;
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
        }
        return query;
    }

    override buildJsonObject(eb: ExpressionBuilder<any, any>, value: Record<string, Expression<unknown>>) {
        return eb.fn(
            'jsonb_build_object',
            Object.entries(value).flatMap(([key, value]) => [sql.lit(key), value]),
        );
    }

    override get supportsUpdateWithLimit(): boolean {
        return false;
    }

    override get supportsDeleteWithLimit(): boolean {
        return false;
    }

    override get supportsDistinctOn(): boolean {
        return true;
    }

    override buildArrayLength(
        eb: ExpressionBuilder<any, any>,
        array: Expression<unknown>,
    ): ExpressionWrapper<any, any, number> {
        return eb.fn('array_length', [array]);
    }

    override buildArrayLiteralSQL(values: unknown[]): string {
        if (values.length === 0) {
            return '{}';
        } else {
            return `ARRAY[${values.map((v) => (typeof v === 'string' ? `'${v}'` : v))}]`;
        }
    }
}
