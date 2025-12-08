import { invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
import {
    ExpressionWrapper,
    sql,
    type Expression,
    type ExpressionBuilder,
    type RawBuilder,
    type SelectQueryBuilder,
} from 'kysely';
import { match } from 'ts-pattern';
import type { BuiltinType, FieldDef, GetModels, SchemaDef } from '../../../schema';
import { DELEGATE_JOINED_FIELD_PREFIX } from '../../constants';
import type { FindArgs } from '../../crud-types';
import { createInternalError } from '../../errors';
import { AnyNullClass, DbNullClass, JsonNullClass } from '../../null-values';
import {
    getDelegateDescendantModels,
    getManyToManyRelation,
    getRelationForeignKeyFieldPairs,
    requireField,
    requireIdFields,
    requireModel,
} from '../../query-utils';
import { BaseCrudDialect } from './base-dialect';

export class SqliteCrudDialect<Schema extends SchemaDef> extends BaseCrudDialect<Schema> {
    override get provider() {
        return 'sqlite' as const;
    }

    override transformPrimitive(value: unknown, type: BuiltinType, _forArrayField: boolean): unknown {
        if (value === undefined) {
            return value;
        }

        // Handle special null classes for JSON fields
        if (value instanceof JsonNullClass) {
            return 'null';
        } else if (value instanceof DbNullClass) {
            return null;
        } else if (value instanceof AnyNullClass) {
            invariant(false, 'should not reach here: AnyNull is not a valid input value');
        }

        if (type === 'Json' || (this.schema.typeDefs && type in this.schema.typeDefs)) {
            // JSON data should be stringified
            return JSON.stringify(value);
        }

        if (Array.isArray(value)) {
            return value.map((v) => this.transformPrimitive(v, type, false));
        } else {
            return match(type)
                .with('Boolean', () => (value ? 1 : 0))
                .with('DateTime', () =>
                    value instanceof Date
                        ? value.toISOString()
                        : typeof value === 'string'
                          ? new Date(value).toISOString()
                          : value,
                )
                .with('Decimal', () => (value as Decimal).toString())
                .with('Bytes', () => Buffer.from(value as Uint8Array))
                .otherwise(() => value);
        }
    }

    override transformOutput(value: unknown, type: BuiltinType) {
        if (value === null || value === undefined) {
            return value;
        } else if (this.schema.typeDefs && type in this.schema.typeDefs) {
            // typed JSON field
            return this.transformOutputJson(value);
        } else {
            return match(type)
                .with('Boolean', () => this.transformOutputBoolean(value))
                .with('DateTime', () => this.transformOutputDate(value))
                .with('Bytes', () => this.transformOutputBytes(value))
                .with('Decimal', () => this.transformOutputDecimal(value))
                .with('BigInt', () => this.transformOutputBigInt(value))
                .with('Json', () => this.transformOutputJson(value))
                .otherwise(() => super.transformOutput(value, type));
        }
    }

    private transformOutputDecimal(value: unknown) {
        if (value instanceof Decimal) {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number' || value instanceof Decimal,
            `Expected string, number or Decimal, got ${typeof value}`,
        );
        return new Decimal(value);
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

    private transformOutputBoolean(value: unknown) {
        return !!value;
    }

    private transformOutputDate(value: unknown) {
        if (typeof value === 'number') {
            return new Date(value);
        } else if (typeof value === 'string') {
            return new Date(value);
        } else {
            return value;
        }
    }

    private transformOutputBytes(value: unknown) {
        return Buffer.isBuffer(value) ? Uint8Array.from(value) : value;
    }

    private transformOutputJson(value: unknown) {
        // better-sqlite3 typically returns JSON as string; be tolerant
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch (e) {
                throw createInternalError('Invalid JSON returned', undefined, { cause: e });
            }
        }
        return value;
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
        let tbl: SelectQueryBuilder<any, any, any>;

        if (this.canJoinWithoutNestedSelect(relationModelDef, payload)) {
            // join without needing a nested select on relation model
            tbl = this.buildModelSelect(relationModel, subQueryName, payload, false);

            // add parent join filter
            tbl = this.buildRelationJoinFilter(tbl, model, relationField, subQueryName, parentAlias);
        } else {
            // need to make a nested select on relation model
            tbl = eb.selectFrom(() => {
                // nested query name
                const selectModelAlias = `${parentAlias}$${relationField}$sub`;

                // select all fields
                let selectModelQuery = this.buildModelSelect(relationModel, selectModelAlias, payload, true);

                // add parent join filter
                selectModelQuery = this.buildRelationJoinFilter(
                    selectModelQuery,
                    model,
                    relationField,
                    selectModelAlias,
                    parentAlias,
                );
                return selectModelQuery.as(subQueryName);
            });
        }

        tbl = tbl.select(() => {
            type ArgsType = Expression<any> | RawBuilder<any> | SelectQueryBuilder<any, any, any>;
            const objArgs: ArgsType[] = [];

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
                // select all scalar fields except for omitted
                const omit = typeof payload === 'object' ? payload.omit : undefined;
                objArgs.push(
                    ...Object.entries(relationModelDef.fields)
                        .filter(([, value]) => !value.relation)
                        .filter(([name]) => !this.shouldOmitField(omit, relationModel, name))
                        .map(([field]) => [sql.lit(field), this.fieldRef(relationModel, field, subQueryName, false)])
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
                                        this.fieldRef(relationModel, field, subQueryName, false) as ArgsType,
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
                    .as('$data');
            } else {
                return sql`json_object(${sql.join(objArgs)})`.as('$data');
            }
        });

        return tbl;
    }

    private buildRelationJoinFilter(
        selectModelQuery: SelectQueryBuilder<any, any, {}>,
        model: string,
        relationField: string,
        relationModelAlias: string,
        parentAlias: string,
    ) {
        const fieldDef = requireField(this.schema, model, relationField);
        const relationModel = fieldDef.type as GetModels<Schema>;

        const m2m = getManyToManyRelation(this.schema, model, relationField);
        if (m2m) {
            // many-to-many relation
            const parentIds = requireIdFields(this.schema, model);
            const relationIds = requireIdFields(this.schema, relationModel);
            invariant(parentIds.length === 1, 'many-to-many relation must have exactly one id field');
            invariant(relationIds.length === 1, 'many-to-many relation must have exactly one id field');
            selectModelQuery = selectModelQuery.where((eb) =>
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
            const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(this.schema, model, relationField);
            keyPairs.forEach(({ fk, pk }) => {
                if (ownedByModel) {
                    // the parent model owns the fk
                    selectModelQuery = selectModelQuery.whereRef(
                        `${relationModelAlias}.${pk}`,
                        '=',
                        `${parentAlias}.${fk}`,
                    );
                } else {
                    // the relation side owns the fk
                    selectModelQuery = selectModelQuery.whereRef(
                        `${relationModelAlias}.${fk}`,
                        '=',
                        `${parentAlias}.${pk}`,
                    );
                }
            });
        }
        return selectModelQuery;
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

    override buildJsonObject(value: Record<string, Expression<unknown>>) {
        return this.eb.fn(
            'json_object',
            Object.entries(value).flatMap(([key, value]) => [sql.lit(key), value]),
        );
    }

    protected override buildJsonPathSelection(
        receiver: Expression<any>,
        path: string[],
        _asType: 'string' | 'json',
    ): Expression<any> {
        if (path.length === 0) {
            return receiver;
        }

        // build a JSON path from the path segments
        // array indices should use bracket notation: $.a[0].b instead of $.a.0.b
        const jsonPath =
            '$' +
            path
                .map((p) => {
                    // check if the segment is a numeric array index
                    if (/^\d+$/.test(p)) {
                        return `[${p}]`;
                    }
                    return `.${p}`;
                })
                .join('');
        return this.eb.fn('json_extract', [receiver, this.eb.val(jsonPath)]);
    }

    protected override buildJsonArrayFilter(
        lhs: Expression<any>,
        operation: 'array_contains' | 'array_starts_with' | 'array_ends_with',
        value: unknown,
    ) {
        return match(operation)
            .with('array_contains', () => sql<any>`EXISTS (SELECT 1 FROM json_each(${lhs}) WHERE value = ${value})`)
            .with('array_starts_with', () =>
                this.eb(this.eb.fn('json_extract', [lhs, this.eb.val('$[0]')]), '=', value),
            )
            .with('array_ends_with', () =>
                this.eb(sql`json_extract(${lhs}, '$[' || (json_array_length(${lhs}) - 1) || ']')`, '=', value),
            )
            .exhaustive();
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

    override buildArrayLength(array: Expression<unknown>): ExpressionWrapper<any, any, number> {
        return this.eb.fn('json_array_length', [array]);
    }

    override buildArrayLiteralSQL(_values: unknown[]): string {
        throw new Error('SQLite does not support array literals');
    }

    override get supportInsertWithDefault() {
        return false;
    }

    override getFieldSqlType(fieldDef: FieldDef) {
        // TODO: respect `@db.x` attributes
        if (fieldDef.relation) {
            throw createInternalError('Cannot get SQL type of a relation field');
        }
        if (fieldDef.array) {
            throw createInternalError('SQLite does not support scalar list type');
        }

        if (this.schema.enums?.[fieldDef.type]) {
            // enums are stored as text
            return 'text';
        }

        return (
            match(fieldDef.type)
                .with('String', () => 'text')
                .with('Boolean', () => 'integer')
                .with('Int', () => 'integer')
                .with('BigInt', () => 'integer')
                .with('Float', () => 'real')
                .with('Decimal', () => 'decimal')
                .with('DateTime', () => 'numeric')
                .with('Bytes', () => 'blob')
                .with('Json', () => 'jsonb')
                // fallback to text
                .otherwise(() => 'text')
        );
    }

    override getStringCasingBehavior() {
        // SQLite `LIKE` is case-insensitive, and there is no `ILIKE`
        return { supportsILike: false, likeCaseSensitive: false };
    }
}
