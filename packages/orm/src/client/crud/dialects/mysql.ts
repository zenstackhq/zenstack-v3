import { enumerate, invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
import type { TableExpression } from 'kysely';
import {
    expressionBuilder,
    sql,
    type Expression,
    type ExpressionBuilder,
    type ExpressionWrapper,
    type RawBuilder,
    type SelectQueryBuilder,
    type SqlBool,
} from 'kysely';
import { match } from 'ts-pattern';
import { AnyNullClass, DbNullClass, JsonNullClass } from '../../../common-types';
import type { BuiltinType, FieldDef, GetModels, SchemaDef } from '../../../schema';
import type { OrArray } from '../../../utils/type-utils';
import { AGGREGATE_OPERATORS, DELEGATE_JOINED_FIELD_PREFIX } from '../../constants';
import type { FindArgs, OrderBy, SortOrder } from '../../crud-types';
import { createInternalError, createInvalidInputError } from '../../errors';
import type { ClientOptions } from '../../options';
import {
    aggregate,
    buildJoinPairs,
    getDelegateDescendantModels,
    getManyToManyRelation,
    isEnum,
    isRelationField,
    isTypeDef,
    requireField,
    requireIdFields,
    requireModel,
} from '../../query-utils';
import { BaseCrudDialect } from './base-dialect';

export class MySqlCrudDialect<Schema extends SchemaDef> extends BaseCrudDialect<Schema> {
    constructor(schema: Schema, options: ClientOptions<Schema>) {
        super(schema, options);
    }

    override get provider() {
        return 'mysql' as const;
    }

    // #region capabilities

    override get supportsUpdateWithLimit(): boolean {
        // MySQL supports UPDATE with LIMIT
        return true;
    }

    override get supportsDeleteWithLimit(): boolean {
        // MySQL supports DELETE with LIMIT
        return true;
    }

    override get supportsDistinctOn(): boolean {
        // MySQL doesn't support DISTINCT ON
        return false;
    }

    override get supportsReturning(): boolean {
        // MySQL doesn't have reliable RETURNING support until 8.0.21+
        // and even then it's limited compared to PostgreSQL
        return false;
    }

    override get supportsInsertDefaultValues(): boolean {
        return false;
    }

    override get insertIgnoreMethod() {
        return 'ignore' as const;
    }

    // #endregion

    // #region value transformation

    override transformInput(value: unknown, type: BuiltinType, forArrayField: boolean): unknown {
        if (value === undefined) {
            return value;
        }

        // Handle special null classes for JSON fields
        if (value instanceof JsonNullClass) {
            return this.eb.cast(sql.lit('null'), 'json');
        } else if (value instanceof DbNullClass) {
            return null;
        } else if (value instanceof AnyNullClass) {
            invariant(false, 'should not reach here: AnyNull is not a valid input value');
        }

        // MySQL doesn't have native array types, arrays are stored as JSON
        if (isTypeDef(this.schema, type)) {
            // type-def fields (regardless array or scalar) are stored as scalar `Json` and
            // their input values need to be stringified if not already (i.e., provided in
            // default values)
            if (typeof value !== 'string') {
                return this.transformInput(value, 'Json', forArrayField);
            } else {
                return value;
            }
        } else if (Array.isArray(value)) {
            // MySQL stores arrays as JSON, so stringify them
            if (type === 'Json' && !forArrayField) {
                // scalar `Json` fields need their input stringified
                return JSON.stringify(value);
            }
            // TODO: check me, `Json[]` fields stored as JSON arrays
            return JSON.stringify(value.map((v) => this.transformInput(v, type, false)));
        } else {
            return match(type)
                .with('Boolean', () => (value ? 1 : 0)) // MySQL uses 1/0 for boolean like SQLite
                .with('DateTime', () => {
                    // MySQL DATETIME format: 'YYYY-MM-DD HH:MM:SS.mmm'
                    if (value instanceof Date) {
                        // return value.toISOString().replace('T', ' ').replace('Z', '');
                        return value.toISOString().replace('Z', '+00:00');
                    } else if (typeof value === 'string') {
                        // return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
                        return new Date(value).toISOString().replace('Z', '+00:00');
                    } else {
                        return value;
                    }
                })
                .with('Decimal', () => (value !== null ? value.toString() : value))
                .with('Json', () => {
                    return this.eb.cast(this.eb.val(JSON.stringify(value)), 'json');
                })
                .with('Bytes', () =>
                    Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : value,
                )
                .otherwise(() => value);
        }
    }

    override transformOutput(value: unknown, type: BuiltinType, array: boolean) {
        if (value === null || value === undefined) {
            return value;
        }
        return match(type)
            .with('Boolean', () => this.transformOutputBoolean(value))
            .with('DateTime', () => this.transformOutputDate(value))
            .with('Bytes', () => this.transformOutputBytes(value))
            .with('BigInt', () => this.transformOutputBigInt(value))
            .with('Decimal', () => this.transformDecimal(value))
            .when(
                (type) => isEnum(this.schema, type),
                () => this.transformOutputEnum(value, array),
            )
            .otherwise(() => super.transformOutput(value, type, array));
    }

    private transformOutputBoolean(value: unknown) {
        // MySQL returns boolean as 1/0
        return !!value;
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
            // MySQL DateTime columns are returned as strings (non-ISO but parsable as JS Date),
            // convert to ISO Date by appending 'Z' if not present
            return new Date(!value.endsWith('Z') ? value + 'Z' : value);
        } else if (value instanceof Date) {
            return value;
        } else {
            return value;
        }
    }

    private transformOutputBytes(value: unknown) {
        return Buffer.isBuffer(value) ? Uint8Array.from(value) : value;
    }

    private transformOutputEnum(value: unknown, array: boolean) {
        if (array && typeof value === 'string') {
            try {
                // MySQL returns enum arrays as JSON strings, parse them back
                return JSON.parse(value);
            } catch {
                // fall through - return as-is if parsing fails
            }
        }
        return value;
    }

    // #endregion

    // #region other overrides

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

        // MySQL 8.0.14+ supports LATERAL joins
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

                        if (typeof payload !== 'object' || payload.take === undefined) {
                            // force adding a limit otherwise the ordering is ignored by mysql
                            // during JSON_ARRAYAGG
                            subQuery = subQuery.limit(Number.MAX_SAFE_INTEGER);
                        }

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
                this.and(...joinPairs.map(([left, right]) => eb(this.eb.ref(left), '=', this.eb.ref(right)))),
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
                // MySQL uses JSON_ARRAYAGG instead of jsonb_agg
                return eb.fn
                    .coalesce(sql`JSON_ARRAYAGG(JSON_OBJECT(${sql.join(objArgs)}))`, sql`JSON_ARRAY()`)
                    .as('$data');
            } else {
                // MySQL uses JSON_OBJECT instead of jsonb_build_object
                return sql`JSON_OBJECT(${sql.join(objArgs)})`.as('$data');
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
            // select all scalar fields except for omitted
            const omit = typeof payload === 'object' ? payload.omit : undefined;
            objArgs.push(
                ...Object.entries(relationModelDef.fields)
                    .filter(([, value]) => !value.relation)
                    .filter(([name]) => !this.shouldOmitField(omit, relationModel, name))
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
            if (take === undefined) {
                // MySQL requires offset to be used with limit
                query = query.limit(Number.MAX_SAFE_INTEGER);
            }
        }
        return query;
    }

    override buildJsonObject(value: Record<string, Expression<unknown>>) {
        // MySQL uses JSON_OBJECT instead of jsonb_build_object
        return this.eb.fn(
            'JSON_OBJECT',
            Object.entries(value).flatMap(([key, value]) => [sql.lit(key), value]),
        );
    }

    override castInt<T extends Expression<any>>(expression: T): T {
        return this.eb.cast(expression, sql.raw('unsigned')) as unknown as T;
    }

    override castText<T extends Expression<any>>(expression: T): T {
        // Use utf8mb4 character set collation to match MySQL 8.0+ default and avoid
        // collation conflicts when comparing with VALUES ROW columns
        return sql`CAST(${expression} AS CHAR CHARACTER SET utf8mb4)` as unknown as T;
    }

    override trimTextQuotes<T extends Expression<string>>(expression: T): T {
        return sql`TRIM(BOTH ${sql.lit('"')} FROM ${expression})` as unknown as T;
    }

    override buildArrayLength(array: Expression<unknown>): ExpressionWrapper<any, any, number> {
        // MySQL uses JSON_LENGTH instead of array_length
        return this.eb.fn('JSON_LENGTH', [array]);
    }

    override buildArrayLiteralSQL(values: unknown[]): string {
        // MySQL uses JSON arrays since it doesn't have native arrays
        return `JSON_ARRAY(${values.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(',')})`;
    }

    protected override buildJsonEqualityFilter(
        lhs: Expression<any>,
        rhs: unknown,
    ): ExpressionWrapper<any, any, SqlBool> {
        // MySQL's JSON equality comparison is key-order sensitive, use bi-directional JSON_CONTAINS
        // instead to achieve key-order insensitive comparison
        return this.eb.and([
            this.eb.fn('JSON_CONTAINS', [lhs, this.eb.val(JSON.stringify(rhs))]),
            this.eb.fn('JSON_CONTAINS', [this.eb.val(JSON.stringify(rhs)), lhs]),
        ]);
    }

    protected override buildJsonPathSelection(receiver: Expression<any>, path: string | undefined) {
        if (path) {
            // MySQL uses JSON_EXTRACT with JSONPath syntax
            return this.eb.fn('JSON_EXTRACT', [receiver, this.eb.val(path)]);
        } else {
            return receiver;
        }
    }

    protected override buildJsonArrayFilter(
        lhs: Expression<any>,
        operation: 'array_contains' | 'array_starts_with' | 'array_ends_with',
        value: unknown,
    ) {
        return match(operation)
            .with('array_contains', () => {
                // MySQL uses JSON_CONTAINS
                const v = Array.isArray(value) ? value : [value];
                return sql<SqlBool>`JSON_CONTAINS(${lhs}, ${sql.val(JSON.stringify(v))})`;
            })
            .with('array_starts_with', () =>
                this.eb(
                    this.eb.fn('JSON_EXTRACT', [lhs, this.eb.val('$[0]')]),
                    '=',
                    this.transformInput(value, 'Json', false),
                ),
            )
            .with('array_ends_with', () =>
                this.eb(
                    sql`JSON_EXTRACT(${lhs}, CONCAT('$[', JSON_LENGTH(${lhs}) - 1, ']'))`,
                    '=',
                    this.transformInput(value, 'Json', false),
                ),
            )
            .exhaustive();
    }

    protected override buildJsonArrayExistsPredicate(
        receiver: Expression<any>,
        buildFilter: (elem: Expression<any>) => Expression<SqlBool>,
    ) {
        // MySQL doesn't have a direct json_array_elements, we need to use JSON_TABLE or a different approach
        // For simplicity, we'll use EXISTS with a subquery that unnests the JSON array
        return this.eb.exists(
            this.eb
                .selectFrom(sql`JSON_TABLE(${receiver}, '$[*]' COLUMNS(value JSON PATH '$'))`.as('$items'))
                .select(this.eb.lit(1).as('$t'))
                .where(buildFilter(this.eb.ref('$items.value'))),
        );
    }

    override get supportsDefaultAsFieldValue() {
        // MySQL supports INSERT with DEFAULT VALUES
        return true;
    }

    override getFieldSqlType(fieldDef: FieldDef) {
        // TODO: respect `@db.x` attributes
        if (fieldDef.relation) {
            throw createInternalError('Cannot get SQL type of a relation field');
        }

        let result: string;

        if (this.schema.enums?.[fieldDef.type]) {
            // enums are treated as text/varchar
            result = 'varchar(255)';
        } else {
            result = match(fieldDef.type)
                .with('String', () => 'varchar(255)')
                .with('Boolean', () => 'tinyint(1)') // MySQL uses tinyint(1) for boolean
                .with('Int', () => 'int')
                .with('BigInt', () => 'bigint')
                .with('Float', () => 'double')
                .with('Decimal', () => 'decimal')
                .with('DateTime', () => 'datetime')
                .with('Bytes', () => 'blob')
                .with('Json', () => 'json')
                // fallback to text
                .otherwise(() => 'text');
        }

        if (fieldDef.array) {
            // MySQL stores arrays as JSON
            result = 'json';
        }

        return result;
    }

    override getStringCasingBehavior() {
        // MySQL LIKE is case-insensitive by default (depends on collation), no ILIKE support
        return { supportsILike: false, likeCaseSensitive: false };
    }

    override buildOrderBy(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        modelAlias: string,
        orderBy: OrArray<OrderBy<Schema, GetModels<Schema>, boolean, boolean>> | undefined,
        negated: boolean,
        take: number | undefined,
    ) {
        if (!orderBy) {
            return query;
        }

        let result = query;

        const buildFieldRef = (model: string, field: string, modelAlias: string) => {
            const fieldDef = requireField(this.schema, model, field);
            return fieldDef.originModel
                ? this.fieldRef(fieldDef.originModel, field, fieldDef.originModel)
                : this.fieldRef(model, field, modelAlias);
        };

        enumerate(orderBy).forEach((orderBy, index) => {
            for (const [field, value] of Object.entries<any>(orderBy)) {
                if (!value) {
                    continue;
                }

                // aggregations
                if (['_count', '_avg', '_sum', '_min', '_max'].includes(field)) {
                    invariant(value && typeof value === 'object', `invalid orderBy value for field "${field}"`);
                    for (const [k, v] of Object.entries<SortOrder>(value)) {
                        invariant(v === 'asc' || v === 'desc', `invalid orderBy value for field "${field}"`);
                        result = result.orderBy(
                            (eb) => aggregate(eb, buildFieldRef(model, k, modelAlias), field as AGGREGATE_OPERATORS),
                            this.negateSort(v, negated),
                        );
                    }
                    continue;
                }

                switch (field) {
                    case '_count': {
                        invariant(value && typeof value === 'object', 'invalid orderBy value for field "_count"');
                        for (const [k, v] of Object.entries<string>(value)) {
                            invariant(v === 'asc' || v === 'desc', `invalid orderBy value for field "${field}"`);
                            result = result.orderBy(
                                (eb) => eb.fn.count(buildFieldRef(model, k, modelAlias)),
                                this.negateSort(v, negated),
                            );
                        }
                        continue;
                    }
                    default:
                        break;
                }

                const fieldDef = requireField(this.schema, model, field);

                if (!fieldDef.relation) {
                    const fieldRef = buildFieldRef(model, field, modelAlias);
                    if (value === 'asc' || value === 'desc') {
                        result = result.orderBy(fieldRef, this.negateSort(value, negated));
                    } else if (
                        value &&
                        typeof value === 'object' &&
                        'nulls' in value &&
                        'sort' in value &&
                        (value.sort === 'asc' || value.sort === 'desc') &&
                        (value.nulls === 'first' || value.nulls === 'last')
                    ) {
                        // MySQL doesn't support NULLS FIRST/LAST natively
                        // We simulate it with an extra IS NULL/IS NOT NULL order by clause
                        const dir = this.negateSort(value.sort, negated);

                        if (value.nulls === 'first') {
                            // NULLS FIRST: order by IS NULL DESC (nulls=1 first), then the actual field
                            result = result.orderBy(sql`${fieldRef} IS NULL`, 'desc');
                            result = result.orderBy(fieldRef, dir);
                        } else {
                            // NULLS LAST: order by IS NULL ASC (nulls=0 last), then the actual field
                            result = result.orderBy(sql`${fieldRef} IS NULL`, 'asc');
                            result = result.orderBy(fieldRef, dir);
                        }
                    }
                } else {
                    // order by relation
                    const relationModel = fieldDef.type;

                    if (fieldDef.array) {
                        // order by to-many relation
                        if (typeof value !== 'object') {
                            throw createInvalidInputError(`invalid orderBy value for field "${field}"`);
                        }
                        if ('_count' in value) {
                            invariant(
                                value._count === 'asc' || value._count === 'desc',
                                'invalid orderBy value for field "_count"',
                            );
                            const sort = this.negateSort(value._count, negated);
                            result = result.orderBy((eb) => {
                                const subQueryAlias = `${modelAlias}$orderBy$${field}$count`;
                                let subQuery = this.buildSelectModel(relationModel, subQueryAlias);
                                const joinPairs = buildJoinPairs(this.schema, model, modelAlias, field, subQueryAlias);
                                subQuery = subQuery.where(() =>
                                    this.and(
                                        ...joinPairs.map(([left, right]) =>
                                            eb(this.eb.ref(left), '=', this.eb.ref(right)),
                                        ),
                                    ),
                                );
                                subQuery = subQuery.select(() => eb.fn.count(eb.lit(1)).as('_count'));
                                return subQuery;
                            }, sort);
                        }
                    } else {
                        // order by to-one relation
                        const joinAlias = `${modelAlias}$orderBy$${index}`;
                        result = result.leftJoin(`${relationModel} as ${joinAlias}`, (join) => {
                            const joinPairs = buildJoinPairs(this.schema, model, modelAlias, field, joinAlias);
                            return join.on((eb) =>
                                this.and(
                                    ...joinPairs.map(([left, right]) => eb(this.eb.ref(left), '=', this.eb.ref(right))),
                                ),
                            );
                        });
                        result = this.buildOrderBy(result, relationModel, joinAlias, value, negated, take);
                    }
                }
            }
        });

        return result;
    }

    override buildValuesTableSelect(fields: FieldDef[], rows: unknown[][]) {
        const cols = rows[0]?.length ?? 0;

        if (fields.length !== cols) {
            throw createInvalidInputError('Number of fields must match number of columns in each row');
        }

        // check all rows have the same length
        for (const row of rows) {
            if (row.length !== cols) {
                throw createInvalidInputError('All rows must have the same number of columns');
            }
        }

        // build final alias name as `$values(f1, f2, ...)`
        const aliasWithColumns = `$values(${fields.map((f) => f.name).join(', ')})`;

        const eb = expressionBuilder<any, any>();

        return eb
            .selectFrom(
                sql`(VALUES ${sql.join(
                    rows.map((row) => sql`ROW(${sql.join(row.map((v) => sql.val(v)))})`),
                    sql.raw(', '),
                )}) as ${sql.raw(aliasWithColumns)}` as unknown as TableExpression<any, any>,
            )
            .selectAll();
    }

    // #endregion
}
