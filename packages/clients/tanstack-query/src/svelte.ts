import {
    createInfiniteQuery,
    createMutation,
    createQuery,
    useQueryClient,
    type CreateInfiniteQueryOptions,
    type CreateInfiniteQueryResult,
    type CreateMutationOptions,
    type CreateMutationResult,
    type CreateQueryOptions,
    type CreateQueryResult,
    type DefaultError,
    type InfiniteData,
    type QueryFunction,
    type QueryKey,
    type StoreOrVal,
} from '@tanstack/svelte-query';
import { lowerCaseFirst } from '@zenstackhq/common-helpers';
import type {
    AggregateArgs,
    AggregateResult,
    BatchResult,
    CountArgs,
    CountResult,
    CreateArgs,
    CreateManyAndReturnArgs,
    CreateManyArgs,
    DeleteArgs,
    DeleteManyArgs,
    FindFirstArgs,
    FindManyArgs,
    FindUniqueArgs,
    GroupByArgs,
    GroupByResult,
    QueryOptions,
    SelectSubset,
    SimplifiedPlainResult,
    SimplifiedResult,
    Subset,
    UpdateArgs,
    UpdateManyAndReturnArgs,
    UpdateManyArgs,
    UpsertArgs,
} from '@zenstackhq/orm';
import type { GetModels, SchemaDef } from '@zenstackhq/schema';
import { getContext, setContext } from 'svelte';
import { derived, get, type Readable } from 'svelte/store';
import {
    fetcher,
    getQueryKey,
    makeUrl,
    marshal,
    setupInvalidation,
    setupOptimisticUpdate,
    type APIContext,
    type ExtraMutationOptions,
    type ExtraQueryOptions,
} from './utils/common';
import type { TrimDelegateModelOperations, WithOptimistic } from './utils/types';

export type { FetchFn } from './utils/common';

/**
 * The default query endpoint.
 */
export const DEFAULT_QUERY_ENDPOINT = '/api/model';

/**
 * Key for setting and getting the global query context.
 */
export const SvelteQueryContextKey = 'zenstack-svelte-query-context';

/**
 * Set context for query settings.
 *
 * @deprecated use {@link setQuerySettingsContext} instead.
 */
export function setHooksContext(context: APIContext) {
    setContext(SvelteQueryContextKey, context);
}

/**
 * Set context for query settings.
 */
export function setQuerySettingsContext(context: APIContext) {
    setContext(SvelteQueryContextKey, context);
}

function getQuerySettings() {
    const { endpoint, ...rest } = getContext<APIContext>(SvelteQueryContextKey) ?? {};
    return { endpoint: endpoint ?? DEFAULT_QUERY_ENDPOINT, ...rest };
}

export type ModelQueryOptions<T> = Omit<CreateQueryOptions<T, DefaultError>, 'queryKey'> & ExtraQueryOptions;

export type ModelQueryResult<T> = Readable<
    UnwrapStore<CreateQueryResult<WithOptimistic<T>, DefaultError>> & { queryKey: QueryKey }
>;

export type ModelInfiniteQueryOptions<T> = Omit<
    CreateInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
>;

export type ModelInfiniteQueryResult<T> = Readable<
    UnwrapStore<CreateInfiniteQueryResult<T, DefaultError>> & {
        queryKey: QueryKey;
    }
>;

export type ModelMutationOptions<T, TArgs> = Omit<CreateMutationOptions<T, DefaultError, TArgs>, 'mutationFn'> &
    ExtraMutationOptions;

export type ModelMutationResult<T, TArgs> = CreateMutationResult<T, DefaultError, TArgs>;

export type ModelMutationModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    TArgs,
    Array extends boolean = false,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
> = Readable<
    Omit<
        UnwrapStore<ModelMutationResult<SimplifiedResult<Schema, Model, TArgs, Options, false, Array>, TArgs>>,
        'mutateAsync'
    > & {
        mutateAsync<T extends TArgs>(
            args: T,
            options?: ModelMutationOptions<SimplifiedResult<Schema, Model, T, Options, false, Array>, T>,
        ): Promise<SimplifiedResult<Schema, Model, T, Options, false, Array>>;
    }
>;

export type ClientHooks<Schema extends SchemaDef, Options extends QueryOptions<Schema> = QueryOptions<Schema>> = {
    [Model in GetModels<Schema> as `${Uncapitalize<Model>}`]: ModelQueryHooks<Schema, Model, Options>;
};

// Note that we can potentially use TypeScript's mapped type to directly map from ORM contract, but that seems
// to significantly slow down tsc performance ...
export type ModelQueryHooks<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
> = TrimDelegateModelOperations<
    Schema,
    Model,
    {
        useFindUnique<T extends FindUniqueArgs<Schema, Model>>(
            args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options> | null>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options> | null>;

        useFindFirst<T extends FindFirstArgs<Schema, Model>>(
            args?: SelectSubset<T, FindFirstArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options> | null>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options> | null>;

        useFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options>[]>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options>[]>;

        useInfiniteFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelInfiniteQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options>[]>,
        ): ModelInfiniteQueryResult<InfiniteData<SimplifiedPlainResult<Schema, Model, T, Options>[]>>;

        useCreate<T extends CreateArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;

        useCreateMany<T extends CreateManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useCreateManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>[], T>,
        ): ModelMutationModelResult<Schema, Model, T, true, Options>;

        useUpdate<T extends UpdateArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;
        useUpdateMany<T extends UpdateManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useUpdateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>[], T>,
        ): ModelMutationModelResult<Schema, Model, T, true, Options>;

        useUpsert<T extends UpsertArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;
        useDelete<T extends DeleteArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;

        useDeleteMany<T extends DeleteManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useCount<T extends CountArgs<Schema, Model>>(
            args?: Subset<T, CountArgs<Schema, Model>>,
            options?: ModelQueryOptions<CountResult<Schema, Model, T>>,
        ): ModelQueryResult<CountResult<Schema, Model, T>>;

        useAggregate<T extends AggregateArgs<Schema, Model>>(
            args: Subset<T, AggregateArgs<Schema, Model>>,
            options?: ModelQueryOptions<AggregateResult<Schema, Model, T>>,
        ): ModelQueryResult<AggregateResult<Schema, Model, T>>;

        useGroupBy<T extends GroupByArgs<Schema, Model>>(
            args: Subset<T, GroupByArgs<Schema, Model>>,
            options?: ModelQueryOptions<GroupByResult<Schema, Model, T>>,
        ): ModelQueryResult<GroupByResult<Schema, Model, T>>;
    }
>;

/**
 * Gets data query hooks for all models in the schema.
 */
export function useClientQueries<Schema extends SchemaDef, Options extends QueryOptions<Schema> = QueryOptions<Schema>>(
    schema: Schema,
): ClientHooks<Schema, Options> {
    return Object.keys(schema.models).reduce(
        (acc, model) => {
            (acc as any)[lowerCaseFirst(model)] = useModelQueries<Schema, GetModels<Schema>, Options>(
                schema,
                model as GetModels<Schema>,
            );
            return acc;
        },
        {} as ClientHooks<Schema, Options>,
    );
}

/**
 * Gets data query hooks for a specific model in the schema.
 */
export function useModelQueries<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Options extends QueryOptions<Schema>,
>(schema: Schema, model: Model): ModelQueryHooks<Schema, Model, Options> {
    const modelDef = Object.values(schema.models).find((m) => m.name.toLowerCase() === model.toLowerCase());
    if (!modelDef) {
        throw new Error(`Model "${model}" not found in schema`);
    }

    const modelName = modelDef.name;

    return {
        useFindUnique: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findUnique', args, options);
        },

        useFindFirst: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findFirst', args, options);
        },

        useFindMany: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findMany', args, options);
        },

        useInfiniteFindMany: (args: any, options?: any) => {
            return useInternalInfiniteQuery(schema, modelName, 'findMany', args, options);
        },

        useCreate: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'create', options);
        },

        useCreateMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'createMany', options);
        },

        useCreateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'createManyAndReturn', options);
        },

        useUpdate: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'update', options);
        },

        useUpdateMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'updateMany', options);
        },

        useUpdateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'updateManyAndReturn', options);
        },

        useUpsert: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'upsert', options);
        },

        useDelete: (options?: any) => {
            return useInternalMutation(schema, modelName, 'DELETE', 'delete', options);
        },

        useDeleteMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'DELETE', 'deleteMany', options);
        },

        useCount: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'count', args, options);
        },

        useAggregate: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'aggregate', args, options);
        },

        useGroupBy: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'groupBy', args, options);
        },
    } as ModelQueryHooks<Schema, Model, Options>;
}

export function useInternalQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args?: StoreOrVal<unknown>,
    options?: StoreOrVal<Omit<CreateQueryOptions<TQueryFnData, DefaultError, TData>, 'queryKey'> & ExtraQueryOptions>,
) {
    const { endpoint, fetch } = getQuerySettings();
    const argsValue = unwrapStore(args);
    const reqUrl = makeUrl(endpoint, model, operation, argsValue);
    const optionsValue = unwrapStore(options);
    const queryKey = getQueryKey(model, operation, argsValue, {
        infinite: false,
        optimisticUpdate: optionsValue?.optimisticUpdate !== false,
    });
    const queryFn: QueryFunction<TQueryFnData, QueryKey, unknown> = ({ signal }) =>
        fetcher<TQueryFnData>(reqUrl, { signal }, fetch);

    let mergedOpt: any;
    if (isStore(options)) {
        // options is store
        mergedOpt = derived([options], ([$opt]) => {
            return {
                queryKey,
                queryFn,
                ...($opt as object),
            };
        });
    } else {
        // options is value
        mergedOpt = {
            queryKey,
            queryFn,
            ...options,
        };
    }

    const result = createQuery<TQueryFnData, DefaultError, TData>(mergedOpt);
    return derived(result, (r) => ({
        queryKey,
        ...r,
    }));
}

export function useInternalInfiniteQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args: StoreOrVal<unknown>,
    options:
        | StoreOrVal<
              Omit<
                  CreateInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
                  'queryKey' | 'initialPageParam'
              >
          >
        | undefined,
) {
    options = options ?? { getNextPageParam: () => undefined };
    const { endpoint, fetch } = getQuerySettings();
    const argsValue = unwrapStore(args);
    const queryKey = getQueryKey(model, operation, argsValue, { infinite: true, optimisticUpdate: false });
    const queryFn: QueryFunction<TQueryFnData, QueryKey, unknown> = ({ pageParam, signal }) =>
        fetcher<TQueryFnData>(makeUrl(endpoint, model, operation, pageParam ?? argsValue), { signal }, fetch);

    let mergedOpt: StoreOrVal<CreateInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>>;
    if (isStore(options)) {
        // options is store
        mergedOpt = derived([options], ([$opt]) => {
            return {
                queryKey,
                queryFn,
                initialPageParam: argsValue,
                ...$opt,
            };
        });
    } else {
        // options is value
        mergedOpt = {
            queryKey,
            queryFn,
            initialPageParam: argsValue,
            ...options,
        };
    }

    const result = createInfiniteQuery<TQueryFnData, DefaultError, InfiniteData<TData>>(mergedOpt);
    return derived(result, (r) => ({
        queryKey,
        ...r,
    }));
}

/**
 * Creates a svelte-query mutation
 *
 * @private
 *
 * @param model The name of the model under mutation.
 * @param method The HTTP method.
 * @param operation The mutation operation (e.g. `create`).
 * @param options The svelte-query options.
 * @param checkReadBack Whether to check for read back errors and return undefined if found.
 */
export function useInternalMutation<TArgs, R = any>(
    schema: SchemaDef,
    model: string,
    method: 'POST' | 'PUT' | 'DELETE',
    operation: string,
    options?: StoreOrVal<Omit<CreateMutationOptions<R, DefaultError, TArgs>, 'mutationFn'> & ExtraMutationOptions>,
) {
    const { endpoint, fetch, logging } = getQuerySettings();
    const queryClient = useQueryClient();
    const optionsValue = unwrapStore(options);
    const mutationFn = (data: any) => {
        const reqUrl =
            method === 'DELETE' ? makeUrl(endpoint, model, operation, data) : makeUrl(endpoint, model, operation);
        const fetchInit: RequestInit = {
            method,
            ...(method !== 'DELETE' && {
                headers: {
                    'content-type': 'application/json',
                },
                body: marshal(data),
            }),
        };
        return fetcher<R>(reqUrl, fetchInit, fetch) as Promise<R>;
    };

    let mergedOpt: StoreOrVal<CreateMutationOptions<R, DefaultError, TArgs>>;

    if (isStore(options)) {
        mergedOpt = derived([options], ([$opt]) => ({
            ...$opt,
            mutationFn,
        }));
    } else {
        mergedOpt = {
            ...options,
            mutationFn,
        };
    }

    const invalidateQueries = optionsValue?.invalidateQueries !== false;
    const optimisticUpdate = !!optionsValue?.optimisticUpdate;

    if (operation) {
        if (invalidateQueries) {
            setupInvalidation(
                model,
                operation,
                schema,
                unwrapStore(mergedOpt),
                (predicate) => queryClient.invalidateQueries({ predicate }),
                logging,
            );
        }

        if (optimisticUpdate) {
            setupOptimisticUpdate(
                model,
                operation,
                schema,
                unwrapStore(mergedOpt),
                queryClient.getQueryCache().getAll(),
                (queryKey, data) => queryClient.setQueryData<unknown>(queryKey, data),
                invalidateQueries ? (predicate) => queryClient.invalidateQueries({ predicate }) : undefined,
                logging,
            );
        }
    }

    return createMutation(mergedOpt);
}

function isStore<T>(opt: unknown): opt is Readable<T> {
    return typeof (opt as any)?.subscribe === 'function';
}

function unwrapStore<T>(storeOrValue: StoreOrVal<T>): T {
    return isStore(storeOrValue) ? get(storeOrValue) : storeOrValue;
}

type UnwrapStore<T> = T extends Readable<infer U> ? U : T;
