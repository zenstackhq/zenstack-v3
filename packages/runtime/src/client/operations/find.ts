import { Console, Effect } from 'effect';
import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { SchemaDef } from '../../schema/schema';
import { QueryError } from '../errors';
import {
    isScalarField,
    requireField,
    requireModel,
    requireModelEffect,
} from '../query-utils';
import type { FindArgs } from '../types';
import type { OperationContext, Operations } from './context';
import { getQueryDialect } from './dialect';
import { makeFindSchema } from './parse';

export function runFind(
    { db, schema, model, operation }: OperationContext,
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

            const finalResult =
                operation === 'findMany' ? result : result[0] ?? null;
            yield* Console.log(`${operation} result:`, finalResult);
            return finalResult;
        })
    );
}

function parseFindArgs(
    schema: SchemaDef,
    model: string,
    operation: Operations,
    args: unknown
) {
    const findSchema = makeFindSchema(
        schema,
        model,
        operation === 'findUnique'
    );

    return Effect.try({
        try: () => findSchema.parse(args),
        catch: (e) => new QueryError(`Invalid find args: ${e}`),
    });
}

export function runQuery(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    operation: string,
    args: FindArgs<SchemaDef, string> | undefined
): Effect.Effect<any[], QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);

        // table
        let query = db.selectFrom(`${modelDef.dbTable}`);

        if (operation !== 'findMany') {
            query = query.limit(1);
        }

        // where
        if (args?.where) {
            query = buildWhere(query, args.where);
        }

        // skip
        if (args?.skip) {
            query = query.offset(args.skip);
        }

        // take
        if (args?.take) {
            query = query.limit(args.take);
        }

        // select
        if (args?.select) {
            query = buildFieldSelection(
                schema,
                model,
                query,
                args?.select,
                modelDef.dbTable
            );
        } else {
            query = buildSelectAllScalarFields(schema, model, query);
        }

        // include
        if (args?.include) {
            query = buildFieldSelection(
                schema,
                model,
                query,
                args?.include,
                modelDef.dbTable
            );
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
        return rows;
    });
}

function buildWhere(
    query: SelectQueryBuilder<any, any, {}>,
    where: Record<string, any> | undefined
) {
    let result = query;
    if (!where) {
        return result;
    }

    result = Object.entries(where).reduce(
        (acc, [field, value]) => acc.where(field, '=', value),
        result
    );

    return result;
}

function buildFieldSelection(
    schema: SchemaDef,
    model: string,
    query: SelectQueryBuilder<any, any, {}>,
    selectOrInclude: Record<string, any>,
    parentName: string
) {
    let result = query;

    for (const [field, payload] of Object.entries(selectOrInclude)) {
        if (!payload) {
            continue;
        }
        const fieldDef = requireField(schema, model, field);
        if (!fieldDef.relation) {
            result = result.select(field);
        } else {
            result = buildRelationSelection(
                result,
                schema,
                model,
                field,
                parentName,
                payload
            );
        }
    }

    return result;
}

function buildRelationSelection(
    query: SelectQueryBuilder<any, any, {}>,
    schema: SchemaDef,
    model: string,
    relationField: string,
    parentName: string,
    payload: any
) {
    const queryDialect = getQueryDialect(schema.provider);
    if (!queryDialect) {
        throw new QueryError(`Unsupported provider: ${schema.provider}`);
    }

    return queryDialect.buildRelationSelection(
        query,
        schema,
        model,
        relationField,
        parentName,
        payload
    );
}

function buildSelectAllScalarFields(
    schema: SchemaDef,
    model: string,
    query: SelectQueryBuilder<any, any, {}>
) {
    let result = query;
    const modelDef = requireModel(schema, model);
    return Object.keys(modelDef.fields)
        .filter((f) => isScalarField(schema, model, f))
        .reduce((acc, f) => acc.select(f), result);
}
