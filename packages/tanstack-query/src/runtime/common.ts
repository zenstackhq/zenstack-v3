import type { AggregateArgs, AggregateResult, BatchResult, CountArgs, CountResult, CreateArgs, CreateManyAndReturnArgs, CreateManyArgs, CrudOperation, DeleteArgs, DeleteManyArgs, FindFirstArgs, FindManyArgs, FindUniqueArgs, GroupByArgs, GroupByResult, ModelResult, UpdateArgs, UpdateManyAndReturnArgs, UpdateManyArgs, UpsertArgs } from '@zenstackhq/runtime';
import type { GetModels, SchemaDef } from '@zenstackhq/runtime/schema';

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

export type CrudOperationArgsMap<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    findFirst: FindFirstArgs<Schema, Model>,
    findMany: FindManyArgs<Schema, Model>,
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

export type CrudOperationResultsMap<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    findFirst: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['findFirst']> | null;
    findMany: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['findMany']>[];
    findUnique: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['findUnique']>;
    create: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['create']>;
    createMany: BatchResult;
    createManyAndReturn: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['createManyAndReturn']>[];
    upsert: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['upsert']>;
    update: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['update']>;
    updateMany: BatchResult;
    updateManyAndReturn: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['updateManyAndReturn']>[];
    delete: ModelResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['delete']>;
    deleteMany: BatchResult;
    count: CountResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['count']>;
    aggregate: AggregateResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['aggregate']>;
    groupBy: GroupByResult<Schema, Model, CrudOperationArgsMap<Schema, Model>['groupBy']>;
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
    Args extends OperationArgs<Schema, Model, Operation>,
> = [
        prefix: typeof QUERY_KEY_PREFIX,
        model: Model,
        operation: Operation,
        args: Args,
        extraOptions: ExtraQueryOptions,
    ];

export type OperationArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends CrudOperation,
> = CrudOperationArgsMap<Schema, Model>[Operation];

export type OperationResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends CrudOperation,
> = CrudOperationResultsMap<Schema, Model>[Operation];

export function getQueryKey<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends CrudOperation,
    Args extends OperationArgs<Schema, Model, Operation>,
>(
    schema: Schema,
    model: Model,
    operation: Operation,
    args: Args,

    extraOptions: ExtraQueryOptions = {
        infinite: false,
        optimisticUpdate: true,
    },
): QueryKey<Schema, Model, Operation, Args> {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return [QUERY_KEY_PREFIX, model, operation, args, extraOptions]
}

export function isZenStackQueryKey(
    queryKey: readonly unknown[]
): queryKey is QueryKey<SchemaDef, GetModels<SchemaDef>, CrudOperation, any> {
    if (queryKey.length < 5) {
        return false;
    }

    if (queryKey[0] !== QUERY_KEY_PREFIX) {
        return false;
    }

    return true;
}