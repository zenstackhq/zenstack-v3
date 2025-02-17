import { Effect } from 'effect';
import type { SelectQueryBuilder } from 'kysely';
import type { GetModels, SchemaDef } from '../../schema/schema';
import { QueryError } from '../errors';
import {
    buildFieldRef,
    isScalarField,
    requireField,
    requireModel,
    requireModelEffect,
} from '../query-utils';
import type { FindArgs } from '../types';
import type { OperationContext } from './context';
import { getQueryDialect } from './dialect';
import { makeFindSchema } from './parse';

export function runFind<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: unknown
) {
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

function parseFindArgs<Schema extends SchemaDef>(
    { schema, model, operation }: OperationContext<Schema>,
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

export function runQuery<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: FindArgs<Schema, GetModels<Schema>> | undefined
): Effect.Effect<any[], QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(
            context.schema,
            context.model
        );

        // table
        let query = context.kysely.selectFrom(`${modelDef.dbTable}` as any);

        if (context.operation !== 'findMany') {
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
                context,
                query,
                args?.select,
                modelDef.dbTable
            );
        } else {
            query = buildSelectAllScalarFields(context, query);
        }

        // include
        if (args?.include) {
            query = buildFieldSelection(
                context,
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

function buildFieldSelection<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    query: SelectQueryBuilder<any, any, {}>,
    selectOrInclude: Record<string, any>,
    parentName: string
) {
    let result = query;

    for (const [field, payload] of Object.entries(selectOrInclude)) {
        if (!payload) {
            continue;
        }
        const fieldDef = requireField(context.schema, context.model, field);
        if (!fieldDef.relation) {
            result = result.select(field);
        } else {
            result = buildRelationSelection(
                context,
                result,
                field,
                parentName,
                payload
            );
        }
    }

    return result;
}

function buildRelationSelection<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    query: SelectQueryBuilder<any, any, {}>,
    relationField: string,
    parentName: string,
    payload: any
) {
    const queryDialect = getQueryDialect(context.schema.provider);
    if (!queryDialect) {
        throw new QueryError(
            `Unsupported provider: ${context.schema.provider}`
        );
    }

    return queryDialect.buildRelationSelection(
        context,
        query,
        relationField,
        parentName,
        payload
    );
}

function buildSelectAllScalarFields<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    query: SelectQueryBuilder<any, any, {}>
) {
    let result = query;
    const modelDef = requireModel(context.schema, context.model);
    return Object.keys(modelDef.fields)
        .filter((f) => isScalarField(context.schema, context.model, f))
        .reduce((acc, f) => selectScalarField(context, f, acc), result);
}

function selectScalarField<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    field: string,
    qb: SelectQueryBuilder<any, any, {}>
) {
    const fieldDef = requireField(context.schema, context.model, field);
    if (!fieldDef.computed) {
        return qb.select(field);
    } else {
        return qb.select((eb) =>
            buildFieldRef(
                context.schema,
                context.model,
                field,
                context.clientOptions,
                eb
            ).as(field)
        );
    }
}
