import type { SelectQueryBuilder } from 'kysely';
import type { BuiltinType, GetModels, SchemaDef } from '../../schema/schema';
import { QueryError } from '../errors';
import {
    buildFieldRef,
    isRelationField,
    requireField,
    requireModel,
} from '../query-utils';
import type { FindArgs } from '../types';
import type { OperationContext } from './context';
import { getQueryDialect } from './dialect';
import { makeFindSchema } from './parse';

export async function runFind<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: unknown
) {
    // parse args
    const parsedArgs = parseFindArgs(context, args);

    // run query
    const result = await runQuery(context, parsedArgs);

    const finalResult =
        context.operation === 'findMany' ? result : result[0] ?? null;
    return finalResult;
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

    const { data, error } = findSchema.safeParse(args);
    if (error) {
        throw new QueryError(`Invalid find args: ${error.message}`);
    } else {
        return data;
    }
}

export async function runQuery<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: FindArgs<Schema, GetModels<Schema>, true> | undefined
) {
    const modelDef = requireModel(context.schema, context.model);

    // table
    let query = context.kysely.selectFrom(`${modelDef.dbTable}` as any);

    if (context.operation !== 'findMany') {
        query = query.limit(1);
    }

    // where
    if (args?.where) {
        query = buildWhere(query, args.where, context);
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

    try {
        return await query.execute();
    } catch (err) {
        const { sql, parameters } = query.compile();
        throw new QueryError(
            `Failed to execute query: ${err}, sql: ${sql}, parameters: ${parameters}`
        );
    }
}

export function buildWhere<Schema extends SchemaDef>(
    query: SelectQueryBuilder<any, any, {}>,
    where: Record<string, any> | undefined,
    context: OperationContext<Schema>
) {
    let result = query;
    if (!where) {
        return result;
    }

    const regularFields = Object.entries(where).filter(
        ([field]) => !field.startsWith('$')
    );

    // build regular field filters
    const queryDialect = getQueryDialect(context.schema.provider);
    result = regularFields.reduce((acc, [field, value]) => {
        const fieldDef = requireField(context.schema, context.model, field);
        return acc.where(
            field,
            '=',
            queryDialect.transformPrimitive(value, fieldDef.type as BuiltinType)
        );
    }, result);

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
            if (!fieldDef.array && !fieldDef.optional && payload.where) {
                throw new QueryError(
                    `Field "${field}" doesn't support filtering`
                );
            }
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
        .filter((f) => !isRelationField(context.schema, context.model, f))
        .reduce((acc, f) => selectField(context, f, acc), result);
}

function selectField<Schema extends SchemaDef>(
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
