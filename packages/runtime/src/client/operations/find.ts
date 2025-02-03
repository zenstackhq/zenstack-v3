import { Console, Effect } from 'effect';
import type { Kysely, SelectQueryBuilder } from 'kysely';
import { z, ZodSchema } from 'zod';
import type { SchemaDef } from '../../schema/schema';
import { InternalError, QueryError } from '../errors';
import {
    getRelationForeignKeyFieldPairs,
    getUniqueFields,
    isScalarField,
    requireField,
    requireModel,
    requireModelEffect,
} from '../query-utils';
import type { FindArgs } from '../types';
import { assembleResult } from './common';
import { makeIncludeSchema, makeSelectSchema, makeWhereSchema } from './parse';

type FindOperation = 'findMany' | 'findUnique' | 'findFirst';

const ROOT_ALIAS = '$';

export function runFind(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    operation: FindOperation,
    args: unknown
) {
    return Effect.runPromise(
        Effect.gen(function* () {
            // parse args
            const parsedArgs = yield* parseFindArgs(
                schema,
                model,
                operation,
                args
            );

            // run query
            const result = yield* runQuery(
                db,
                schema,
                model,
                operation,
                parsedArgs
            );

            const finalResult = operation === 'findMany' ? result : result[0];
            yield* Console.log(`${operation} result:`, finalResult);
            return finalResult;
        })
    );
}

function parseFindArgs(
    schema: SchemaDef,
    model: string,
    operation: FindOperation,
    args: unknown
) {
    if (!args || typeof args !== 'object') {
        if (operation === 'findUnique') {
            // args is required for findUnique
            return Effect.fail(new QueryError(`Missing query args`));
        } else {
            return Effect.succeed(undefined);
        }
    }

    const baseWhere = makeWhereSchema(schema, model);
    let where: ZodSchema = baseWhere;

    if (operation === 'findUnique') {
        // findUnique requires at least one unique field (field set) is required

        const uniqueFields = getUniqueFields(schema, model);
        if (uniqueFields.length === 0) {
            return Effect.fail(
                new InternalError(`Model "${model}" has no unique fields`)
            );
        }

        if (uniqueFields.length === 1) {
            // only one unique field (set), mark the field(s) required
            where = baseWhere.required(
                uniqueFields[0]!.reduce(
                    (acc, k) => ({
                        ...acc,
                        [k.name]: true,
                    }),
                    {}
                )
            );
        } else {
            where = baseWhere.refine((value) => {
                // check that at least one unique field is set
                return uniqueFields.some((fields) =>
                    fields.every(({ name }) => value[name] !== undefined)
                );
            }, `At least one unique field or field set must be set`);
        }
    } else {
        // where clause is optional
        where = where.optional();
    }

    const select = makeSelectSchema(schema, model).optional();
    const include = makeIncludeSchema(schema, model).optional();

    if ('select' in args && 'include' in args) {
        return Effect.fail(
            new QueryError(
                'Cannot use both "select" and "include" in find args'
            )
        );
    }

    const findSchema = z.object({ where, select, include });

    return Effect.try({
        try: () => findSchema.parse(args),
        catch: (e) => new QueryError(`Invalid find args: ${e}`),
    });
}

function runQuery(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    operation: string,
    args: FindArgs<SchemaDef, string> | undefined
): Effect.Effect<any, QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);

        // table
        let query = db.selectFrom(`${modelDef.dbTable} as ${ROOT_ALIAS}`);

        if (operation !== 'findMany') {
            query = query.limit(1);
        }

        // where
        if (args?.where) {
            query = buildWhere(query, args.where);
        }

        // select
        if (args?.select) {
            query = buildFieldSelection(schema, model, query, args?.select);
        } else {
            query = buildSelectAllFields(schema, model, query);
        }

        // include
        if (args?.include) {
            query = buildFieldSelection(schema, model, query, args?.include);
        }

        const compiled = query.compile();
        yield* Console.log(
            `${operation} query:`,
            compiled.sql,
            compiled.parameters
        );

        const rows = yield* Effect.tryPromise({
            try: () => query.execute(),
            catch: (e) => new QueryError(`Failed to execute query: ${e}`),
        });

        yield* Console.log(`Raw results:`, rows);
        const assembled = assembleResult(schema, model, rows, args);
        return assembled;
    });
}

function buildWhere(
    query: SelectQueryBuilder<any, string, {}>,
    where: Record<string, any> | undefined,
    tableAlias = ROOT_ALIAS
) {
    let result = query;
    if (!where) {
        return result;
    }

    result = Object.entries(where).reduce(
        (acc, [field, value]) =>
            acc.where(
                tableAlias ? `${tableAlias}.${field}` : field,
                '=',
                value
            ),
        result
    );

    return result;
}

function buildFieldSelection(
    schema: SchemaDef,
    model: string,
    query: SelectQueryBuilder<any, string, {}>,
    selectOrInclude: Record<string, any>,
    tableAlias = ROOT_ALIAS
) {
    let result = query;

    for (const [field, payload] of Object.entries(selectOrInclude)) {
        if (!payload) {
            continue;
        }
        const fieldDef = requireField(schema, model, field);
        if (!fieldDef.relation) {
            result = result.select(selectField(tableAlias, field));
        } else {
            result = buildRelationSelection(
                schema,
                model,
                field,
                result,
                payload,
                tableAlias
            );
        }
    }

    return result;
}

function buildRelationSelection(
    schema: SchemaDef,
    model: string,
    relationField: string,
    query: SelectQueryBuilder<any, string, {}>,
    payload: any,
    tableAlias = ROOT_ALIAS
) {
    const relationFieldDef = requireField(schema, model, relationField);
    const relationModel = requireModel(schema, relationFieldDef.type);
    const keyPairs = getRelationForeignKeyFieldPairs(
        schema,
        model,
        relationField
    );

    let result = query;

    const nextAlias = joinAlias(tableAlias, relationField);
    result = result.leftJoin(
        `${relationModel.dbTable} as ${nextAlias}`,
        (join) =>
            keyPairs.reduce(
                (acc, { fk, pk }) =>
                    acc.onRef(
                        `${nextAlias}.${fk}`,
                        '=',
                        tableAlias ? `${tableAlias}.${pk}` : pk
                    ),
                join
            )
    );

    if (payload === true) {
        result = buildSelectAllFields(
            schema,
            relationFieldDef.type,
            result,
            nextAlias
        );
    } else {
        result = buildFieldSelection(
            schema,
            relationFieldDef.type,
            result,
            payload,
            nextAlias
        );
    }

    return result;
}

function buildSelectAllFields(
    schema: SchemaDef,
    model: string,
    query: SelectQueryBuilder<any, string, {}>,
    tableAlias = ROOT_ALIAS
) {
    let result = query;
    const modelDef = requireModel(schema, model);
    return Object.keys(modelDef.fields)
        .filter((f) => isScalarField(schema, model, f))
        .reduce((acc, f) => acc.select(selectField(tableAlias, f)), result);
}

function joinAlias(tableAlias: string, field: string) {
    return `${tableAlias}>${field}`;
}

function selectField(tableAlias: string, field: string) {
    return tableAlias
        ? `${tableAlias}.${field} as ${joinAlias(tableAlias, field)}`
        : `${field} as ${field}`;
}
