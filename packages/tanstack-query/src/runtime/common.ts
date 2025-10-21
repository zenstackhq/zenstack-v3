import type { GetModels, SchemaDef } from '@zenstackhq/runtime/schema';
import type { CrudOperation, FindArgs, AggregateArgs, CountArgs, CreateArgs, UpdateArgs, CreateManyArgs, UpdateManyArgs, CreateManyAndReturnArgs, DeleteArgs, DeleteManyArgs, FindUniqueArgs, GroupByArgs, UpdateManyAndReturnArgs, UpsertArgs } from '@zenstackhq/runtime';

/**
 * The default query endpoint.
 */
export const DEFAULT_QUERY_ENDPOINT = '/api/model';

/**
 * Prefix for TanStack Query keys.
 */
export const QUERY_KEY_PREFIX = 'zenstack';

/**
 * Function signature for `fetch`.
 */
export type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Context type for configuring the hooks.
 */
export type APIContext = {
    /**
     * The endpoint to use for the queries.
     */
    endpoint?: string;

    /**
     * A custom fetch function for sending the HTTP requests.
     */
    fetch?: FetchFn;

    /**
     * If logging is enabled.
     */
    logging?: boolean;
};

/**
 * Extra query options.
 */
export type ExtraQueryOptions = {
    /**
     * Whether this is an infinite query. Defaults to `false`.
     */
    infinite?: boolean;

    /**
     * Whether to opt-in to optimistic updates for this query. Defaults to `true`.
     */
    optimisticUpdate?: boolean;
};

export type CrudOperationTypeMap<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    findFirst: FindArgs<Schema, Model, false>,
    findMany: FindArgs<Schema, Model, true>,
    findUnique: FindUniqueArgs<Schema, Model>,
    create: CreateArgs<Schema, Model>,
    createMany: CreateManyArgs<Schema, Model>,
    createManyAndReturn: CreateManyAndReturnArgs<Schema, Model>,
    upsert: UpsertArgs<Schema, Model>,
    update: UpdateArgs<Schema, Model>,
    updateMany: UpdateManyArgs<Schema, Model>,
    updateManyAndReturn: UpdateManyAndReturnArgs<Schema, Model>,
    delete: DeleteArgs<Schema, Model>,
    deleteMany: DeleteManyArgs<Schema, Model>,
    count: CountArgs<Schema, Model>,
    aggregate: AggregateArgs<Schema, Model>,
    groupBy: GroupByArgs<Schema, Model>,
};

export type QueryOperation = Extract<
    CrudOperation,
    'findFirst' | 'findMany' | 'findUnique' | 'count' | 'aggregate' | 'groupBy'
>;

export type MutationOperation = Exclude<CrudOperation, QueryOperation>;

export type MutationMethod = 'POST' | 'PUT' | 'DELETE';

export type QueryKey<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends CrudOperation,
> = [
        prefix: typeof QUERY_KEY_PREFIX,
        model: Model,
        operation: CrudOperation,
        args: CrudOperationTypeMap<Schema, Model>[Operation],
        extraOptions: ExtraQueryOptions,
    ];

export function getQueryKey<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends CrudOperation,
>(
    schema: Schema,
    model: Model,
    operation: CrudOperation,
    args: CrudOperationTypeMap<Schema, Model>[Operation],

    extraOptions: ExtraQueryOptions = {
        infinite: false,
        optimisticUpdate: true,
    },
): QueryKey<Schema, Model, typeof operation> {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return [QUERY_KEY_PREFIX, model, operation, args, extraOptions]
}

export function isZenStackQueryKey(
    queryKey: readonly unknown[]
): queryKey is QueryKey<SchemaDef, GetModels<SchemaDef>, CrudOperation> {
    if (queryKey.length < 5) {
        return false;
    }

    if (queryKey[0] !== QUERY_KEY_PREFIX) {
        return false;
    }

    return true;
}