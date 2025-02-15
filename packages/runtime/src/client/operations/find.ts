import { Effect } from 'effect';
import type { SelectQueryBuilder } from 'kysely';
import type { SchemaDef } from '../../schema/schema';
import { QueryError } from '../errors';
import {
    isScalarField,
    requireField,
    requireModel,
    requireModelEffect,
} from '../query-utils';
import type { FindArgs } from '../types';
import type { OperationContext } from './context';
import { getQueryDialect } from './dialect';
import { makeFindSchema } from './parse';

export function runFind(context: OperationContext, args: unknown) {
    return Effect.gen(function* () {
        // parse args
        const parsedArgs = yield* parseFindArgs(context, args);

        // run query
        const result = yield* runQuery(context, parsedArgs);

        const finalResult =
            context.operation === 'findMany' ? result : result[0] ?? null;
        return finalResult;
    });
}

function parseFindArgs(
    { schema, model, operation }: OperationContext,
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
    { kysely, schema, model, operation }: OperationContext,
    args: FindArgs<SchemaDef, string> | undefined
): Effect.Effect<any[], QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);

        // table
        let query = kysely.selectFrom(`${modelDef.dbTable}`);

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

        const rows = yield* Effect.tryPromise({
            try: () => query.execute(),
            catch: (e) => {
                const { sql, parameters } = query.compile();
                return new QueryError(
                    `Failed to execute query: ${e}, sql: ${sql}, parameters: ${parameters}`
                );
            },
        });

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

    const regularFields = Object.entries(where).filter(
        ([field]) => !field.startsWith('$')
    );

    // build regular field filters
    result = regularFields.reduce(
        (acc, [field, value]) => acc.where(field, '=', value),
        result
    );

    // call expression builder and combine the results
    if ('$expr' in where && typeof where['$expr'] === 'function') {
        result = result.where((eb) => where['$expr'](eb));
    }

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
