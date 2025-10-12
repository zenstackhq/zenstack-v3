import { invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
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
import { DELEGATE_JOINED_FIELD_PREFIX } from '../../constants';
import type { FindArgs } from '../../crud-types';
import { QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import {
    buildJoinPairs,
    getDelegateDescendantModels,
    getManyToManyRelation,
    isRelationField,
    requireField,
    requireIdFields,
    requireModel,
} from '../../query-utils';
import { BaseCrudDialect } from './base-dialect';

export class PostgresCrudDialect<Schema extends SchemaDef> extends BaseCrudDialect<Schema> {
    constructor(schema: Schema, options: ClientOptions<Schema>) {
        super(schema, options);
    }

    override get provider() {
        return 'postgresql' as const;
    }

    override transformPrimitive(value: unknown, type: BuiltinType, forArrayField: boolean): unknown {
        if (value === undefined) {
            return value;
        }

        if (Array.isArray(value)) {
            if (type === 'Json' && !forArrayField) {
                // node-pg incorrectly handles array values passed to non-array JSON fields,
                // the workaround is to JSON stringify the value
                // https://github.com/brianc/node-postgres/issues/374
                return JSON.stringify(value);
            } else {
                return value.map((v) => this.transformPrimitive(v, type, false));
            }
        } else {
            return match(type)
                .with('DateTime', () =>
                    value instanceof Date
                        ? value.toISOString()
                        : typeof value === 'string'
                          ? new Date(value).toISOString()
                          : value,
                )
                .with('Decimal', () => (value !== null ? value.toString() : value))
                .otherwise(() => value);
        }
    }

    override transformOutput(value: unknown, type: BuiltinType) {
        if (value === null || value === undefined) {
            return value;
        }
        return match(type)
            .with('DateTime', () => this.transformOutputDate(value))
            .with('Bytes', () => this.transformOutputBytes(value))
            .with('BigInt', () => this.transformOutputBigInt(value))
            .with('Decimal', () => this.transformDecimal(value))
            .otherwise(() => super.transformOutput(value, type));
    }

    private transformOutputBigInt(value: unknown) {
        if (typeof value === 'bigint') {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number',
            `Expected string or number, got ${typeof value}`,
        );
        return BigInt(value);
    }

    private transformDecimal(value: unknown) {
        if (value instanceof Decimal) {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number' || value instanceof Decimal,
            `Expected string, number or Decimal, got ${typeof value}`,
        );
        return new Decimal(value);
    }

    private transformOutputDate(value: unknown) {
        if (typeof value === 'string') {
            return new Date(value);
        } else if (value instanceof Date && this.options.fixPostgresTimezone !== false) {
            // SPECIAL NOTES:
            // node-pg has a terrible quirk that it returns the date value in local timezone
            // as a `Date` object although for `DateTime` field the data in DB is stored in UTC
            // see: https://github.com/brianc/node-postgres/issues/429
            return new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
        } else {
            return value;
        }
    }

    private transformOutputBytes(value: unknown) {
        return Buffer.isBuffer(value) ? Uint8Array.from(value) : value;
    }

    override buildRelationSelection(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
    ): SelectQueryBuilder<any, any, any> {
        const relationResultName = `${parentAlias}$${relationField}`;
        const joinedQuery = this.buildRelationJSON(
            model,
            query,
            relationField,
            parentAlias,
            payload,
            relationResultName,
        );
        return joinedQuery.select(`${relationResultName}.$data as ${relationField}`);
    }

    private buildRelationJSON(
        model: string,
        qb: SelectQueryBuilder<any, any, any>,
        relationField: string,
        parentAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        resultName: string,
    ) {
        const relationFieldDef = requireField(this.schema, model, relationField);
        const relationModel = relationFieldDef.type as GetModels<Schema>;

        return qb.leftJoinLateral(
            (eb) => {
                const relationSelectName = `${resultName}$sub`;
                const relationModelDef = requireModel(this.schema, relationModel);

                let tbl: SelectQueryBuilder<any, any, any>;

                if (this.canJoinWithoutNestedSelect(relationModelDef, payload)) {
                    // build join directly
                    tbl = this.buildModelSelect(relationModel, relationSelectName, payload, false);

                    // parent join filter
                    tbl = this.buildRelationJoinFilter(
                        tbl,
                        model,
                        relationField,
                        relationModel,
                        relationSelectName,
                        parentAlias,
                    );
                } else {
                    // join with a nested query
                    tbl = eb.selectFrom(() => {
                        let subQuery = this.buildModelSelect(relationModel, `${relationSelectName}$t`, payload, true);

                        // parent join filter
                        subQuery = this.buildRelationJoinFilter(
                            subQuery,
                            model,
                            relationField,
                            relationModel,
                            `${relationSelectName}$t`,
                            parentAlias,
                        );

                        return subQuery.as(relationSelectName);
                    });
                }

                // select relation result
                tbl = this.buildRelationObjectSelect(
                    relationModel,
                    relationSelectName,
                    relationFieldDef,
                    tbl,
                    payload,
                    resultName,
                );

                // add nested joins for each relation
                tbl = this.buildRelationJoins(tbl, relationModel, relationSelectName, payload, resultName);

                // alias the join table
                return tbl.as(resultName);
            },
            (join) => join.onTrue(),
        );
    }

    private buildRelationJoinFilter(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        relationField: string,
        relationModel: GetModels<Schema>,
        relationModelAlias: string,
        parentAlias: string,
    ) {
        const m2m = getManyToManyRelation(this.schema, model, relationField);
        if (m2m) {
            // many-to-many relation
            const parentIds = requireIdFields(this.schema, model);
            const relationIds = requireIdFields(this.schema, relationModel);
            invariant(parentIds.length === 1, 'many-to-many relation must have exactly one id field');
            invariant(relationIds.length === 1, 'many-to-many relation must have exactly one id field');
            query = query.where((eb) =>
                eb(
                    eb.ref(`${relationModelAlias}.${relationIds[0]}`),
                    'in',
                    eb
                        .selectFrom(m2m.joinTable)
                        .select(`${m2m.joinTable}.${m2m.otherFkName}`)
                        .whereRef(`${parentAlias}.${parentIds[0]}`, '=', `${m2m.joinTable}.${m2m.parentFkName}`),
                ),
            );
        } else {
            const joinPairs = buildJoinPairs(this.schema, model, parentAlias, relationField, relationModelAlias);
            query = query.where((eb) =>
                this.and(...joinPairs.map(([left, right]) => eb(sql.ref(left), '=', sql.ref(right)))),
            );
        }
        return query;
    }

    private buildRelationObjectSelect(
        relationModel: string,
        relationModelAlias: string,
        relationFieldDef: FieldDef,
        qb: SelectQueryBuilder<any, any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentResultName: string,
    ) {
        qb = qb.select((eb) => {
            const objArgs = this.buildRelationObjectArgs(
                relationModel,
                relationModelAlias,
                eb,
                payload,
                parentResultName,
            );

            if (relationFieldDef.array) {
                return eb.fn
                    .coalesce(sql`jsonb_agg(jsonb_build_object(${sql.join(objArgs)}))`, sql`'[]'::jsonb`)
                    .as('$data');
            } else {
                return sql`jsonb_build_object(${sql.join(objArgs)})`.as('$data');
            }
        });

        return qb;
    }

    private buildRelationObjectArgs(
        relationModel: string,
        relationModelAlias: string,
        eb: ExpressionBuilder<any, any>,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentResultName: string,
    ) {
        const relationModelDef = requireModel(this.schema, relationModel);
        const objArgs: Array<
            string | ExpressionWrapper<any, any, any> | SelectQueryBuilder<any, any, any> | RawBuilder<any>
        > = [];

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
                    .map(([field]) => [sql.lit(field), this.fieldRef(relationModel, field, relationModelAlias, false)])
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
                                relationModel as GetModels<Schema>,
                                eb,
                                relationModelAlias,
                                value,
                            );
                            return [sql.lit(field), subJson];
                        } else {
                            const fieldDef = requireField(this.schema, relationModel, field);
                            const fieldValue = fieldDef.relation
                                ? // reference the synthesized JSON field
                                  eb.ref(`${parentResultName}$${field}.$data`)
                                : // reference a plain field
                                  this.fieldRef(relationModel, field, relationModelAlias, false);
                            return [sql.lit(field), fieldValue];
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
                    .map(([field]) => [
                        sql.lit(field),
                        // reference the synthesized JSON field
                        eb.ref(`${parentResultName}$${field}.$data`),
                    ])
                    .flatMap((v) => v),
            );
        }
        return objArgs;
    }

    private buildRelationJoins(
        query: SelectQueryBuilder<any, any, any>,
        relationModel: string,
        relationModelAlias: string,
        payload: true | FindArgs<Schema, GetModels<Schema>, true>,
        parentResultName: string,
    ) {
        let result = query;
        if (typeof payload === 'object') {
            const selectInclude = payload.include ?? payload.select;
            if (selectInclude && typeof selectInclude === 'object') {
                Object.entries<any>(selectInclude)
                    .filter(([, value]) => value)
                    .filter(([field]) => isRelationField(this.schema, relationModel, field))
                    .forEach(([field, value]) => {
                        result = this.buildRelationJSON(
                            relationModel,
                            result,
                            field,
                            relationModelAlias,
                            value,
                            `${parentResultName}$${field}`,
                        );
                    });
            }
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

    override buildJsonObject(value: Record<string, Expression<unknown>>) {
        return this.eb.fn(
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

    override buildArrayLength(array: Expression<unknown>): ExpressionWrapper<any, any, number> {
        return this.eb.fn('array_length', [array]);
    }

    override buildArrayLiteralSQL(values: unknown[]): string {
        if (values.length === 0) {
            return '{}';
        } else {
            return `ARRAY[${values.map((v) => (typeof v === 'string' ? `'${v}'` : v))}]`;
        }
    }

    override get supportInsertWithDefault() {
        return true;
    }

    override getFieldSqlType(fieldDef: FieldDef) {
        // TODO: respect `@db.x` attributes
        if (fieldDef.relation) {
            throw new QueryError('Cannot get SQL type of a relation field');
        }

        let result: string;

        if (this.schema.enums?.[fieldDef.type]) {
            // enums are treated as text
            result = 'text';
        } else {
            result = match(fieldDef.type)
                .with('String', () => 'text')
                .with('Boolean', () => 'boolean')
                .with('Int', () => 'integer')
                .with('BigInt', () => 'bigint')
                .with('Float', () => 'double precision')
                .with('Decimal', () => 'decimal')
                .with('DateTime', () => 'timestamp')
                .with('Bytes', () => 'bytea')
                .with('Json', () => 'jsonb')
                // fallback to text
                .otherwise(() => 'text');
        }

        if (fieldDef.array) {
            result += '[]';
        }

        return result;
    }

    override getStringCasingBehavior() {
        // Postgres `LIKE` is case-sensitive, `ILIKE` is case-insensitive
        return { supportsILike: true, likeCaseSensitive: true };
    }
}
