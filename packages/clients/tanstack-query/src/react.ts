import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
    type DefaultError,
    type InfiniteData,
    type UseInfiniteQueryOptions,
    type UseInfiniteQueryResult,
    type UseMutationOptions,
    type UseMutationResult,
    type UseQueryOptions,
    type UseQueryResult,
    type UseSuspenseInfiniteQueryOptions,
    type UseSuspenseInfiniteQueryResult,
    type UseSuspenseQueryOptions,
    type UseSuspenseQueryResult,
} from '@tanstack/react-query';
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
    FindArgs,
    FindUniqueArgs,
    GroupByArgs,
    GroupByResult,
    ModelResult,
    SelectSubset,
    UpdateArgs,
    UpdateManyAndReturnArgs,
    UpdateManyArgs,
    UpsertArgs,
} from '@zenstackhq/orm';
import type { GetModels, SchemaDef } from '@zenstackhq/schema';
import { createContext, useContext } from 'react';
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

/**
 * The default query endpoint.
 */
export const DEFAULT_QUERY_ENDPOINT = '/api/model';

/**
 * React context for query settings.
 */
export const QuerySettingsContext = createContext<APIContext>({
    endpoint: DEFAULT_QUERY_ENDPOINT,
    fetch: undefined,
});

/**
 * React context provider for configuring query settings.
 */
export const QuerySettingsProvider = QuerySettingsContext.Provider;

/**
 * React context provider for configuring query settings.
 *
 * @deprecated Use `QuerySettingsProvider` instead.
 */
export const Provider = QuerySettingsProvider;

function useHooksContext() {
    const { endpoint, ...rest } = useContext(QuerySettingsContext);
    return { endpoint: endpoint ?? DEFAULT_QUERY_ENDPOINT, ...rest };
}

export type ModelQueryOptions<T> = Omit<UseQueryOptions<T, DefaultError>, 'queryKey'> & ExtraQueryOptions;

export type ModelSuspenseQueryOptions<T> = Omit<UseSuspenseQueryOptions<T, DefaultError>, 'queryKey'> &
    ExtraQueryOptions;

export type ModelInfiniteQueryOptions<T> = Omit<
    UseInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
>;

export type ModelSuspenseInfiniteQueryOptions<T> = Omit<
    UseSuspenseInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
>;

export type ModelMutationOptions<T, TArgs> = Omit<UseMutationOptions<T, DefaultError, TArgs>, 'mutationFn'> &
    ExtraMutationOptions;

export type ModelMutationResult<T, TArgs> = UseMutationResult<T, DefaultError, TArgs>;

export type ModelQueryHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    useFindUnique<T extends FindUniqueArgs<Schema, Model>>(
        args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    useSuspenseFindUnique<T extends FindUniqueArgs<Schema, Model>>(
        args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
        options?: ModelSuspenseQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): UseSuspenseQueryResult<ModelResult<Schema, Model, T> | null>;

    useFindFirst<T extends FindArgs<Schema, Model, false>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, false>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    useSuspenseFindFirst<T extends FindArgs<Schema, Model, false>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, false>>,
        options?: ModelSuspenseQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): UseSuspenseQueryResult<ModelResult<Schema, Model, T> | null>;

    useFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): UseQueryResult<ModelResult<Schema, Model, T>[]>;

    useSuspenseFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelSuspenseQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): UseSuspenseQueryResult<ModelResult<Schema, Model, T>[]>;

    useSuspenseInfiniteFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelSuspenseInfiniteQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): UseSuspenseInfiniteQueryResult<InfiniteData<ModelResult<Schema, Model, T>[]>>;

    useInfiniteFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelInfiniteQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): UseInfiniteQueryResult<InfiniteData<ModelResult<Schema, Model, T>[]>>;

    useCreate<T extends CreateArgs<Schema, Model>>(
        options?: UseMutationOptions<ModelResult<Schema, Model, T>, DefaultError, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useCreateMany<T extends CreateManyArgs<Schema, Model>[]>(
        options?: ModelMutationOptions<BatchResult, T>,
    ): ModelMutationResult<BatchResult, T>;

    useCreateManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>[], T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>[], T>;

    useUpdate<T extends UpdateArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useUpdateMany<T extends UpdateManyArgs<Schema, Model>[]>(
        options?: ModelMutationOptions<BatchResult, T>,
    ): ModelMutationResult<BatchResult, T>;

    useUpdateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>[], T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>[], T>;

    useUpsert<T extends UpsertArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useDelete<T extends DeleteArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useDeleteMany<T extends DeleteManyArgs<Schema, Model>[]>(
        options?: ModelMutationOptions<BatchResult, T>,
    ): ModelMutationResult<BatchResult, T>;

    useCount<T extends CountArgs<Schema, Model>>(
        options?: ModelQueryOptions<CountResult<Schema, Model, T>>,
    ): UseQueryResult<CountResult<Schema, Model, T>>;

    useSuspenseCount<T extends CountArgs<Schema, Model>>(
        options?: ModelSuspenseQueryOptions<CountResult<Schema, Model, T>>,
    ): UseSuspenseQueryResult<CountResult<Schema, Model, T>>;

    useAggregate<T extends AggregateArgs<Schema, Model>>(
        options?: ModelQueryOptions<AggregateResult<Schema, Model, T>>,
    ): UseQueryResult<AggregateResult<Schema, Model, T>>;

    useSuspenseAggregate<T extends AggregateArgs<Schema, Model>>(
        options?: ModelSuspenseQueryOptions<AggregateResult<Schema, Model, T>>,
    ): UseSuspenseQueryResult<AggregateResult<Schema, Model, T>>;

    useGroupBy<T extends GroupByArgs<Schema, Model>>(
        options?: ModelQueryOptions<GroupByResult<Schema, Model, T>>,
    ): UseQueryResult<GroupByResult<Schema, Model, T>>;

    useSuspenseGroupBy<T extends GroupByArgs<Schema, Model>>(
        options?: ModelSuspenseQueryOptions<GroupByResult<Schema, Model, T>>,
    ): UseSuspenseQueryResult<GroupByResult<Schema, Model, T>>;
};

export function useModelQueries<Schema extends SchemaDef, Model extends GetModels<Schema>>(
    schema: Schema,
    model: Model,
): ModelQueryHooks<Schema, Model> {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return {
        useFindUnique: (args: any, options?: any) => {
            return useInternalQuery(schema, model, 'findUnique', args, options);
        },

        useSuspenseFindUnique: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'findUnique', args, options);
        },

        useFindFirst: (args: any, options?: any) => {
            return useInternalQuery(schema, model, 'findFirst', args, options);
        },

        useSuspenseFindFirst: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'findFirst', args, options);
        },

        useFindMany: (args: any, options?: any) => {
            return useInternalQuery(schema, model, 'findMany', args, options);
        },

        useSuspenseFindMany: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'findMany', args, options);
        },

        useInfiniteFindMany: (args: any, options?: any) => {
            return useInternalInfiniteQuery(schema, model, 'findMany', args, options);
        },

        useSuspenseInfiniteFindMany: (args: any, options?: any) => {
            return useInternalSuspenseInfiniteQuery(schema, model, 'findMany', args, options);
        },

        useCreate: (options?: any) => {
            return useInternalMutation(schema, model, 'POST', 'create', options, true);
        },

        useCreateMany: (options?: any) => {
            return useInternalMutation(schema, model, 'POST', 'createMany', options, false);
        },

        useCreateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, model, 'POST', 'createManyAndReturn', options, true);
        },

        useUpdate: (options?: any) => {
            return useInternalMutation(schema, model, 'PUT', 'update', options, true);
        },

        useUpdateMany: (options?: any) => {
            return useInternalMutation(schema, model, 'PUT', 'updateMany', options, false);
        },

        useUpdateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, model, 'PUT', 'updateManyAndReturn', options, true);
        },

        useUpsert: (options?: any) => {
            return useInternalMutation(schema, model, 'POST', 'upsert', options, true);
        },

        useDelete: (options?: any) => {
            return useInternalMutation(schema, model, 'DELETE', 'delete', options, true);
        },

        useDeleteMany: (options?: any) => {
            return useInternalMutation(schema, model, 'DELETE', 'deleteMany', options, false);
        },

        useCount: (options?: any) => {
            return useInternalQuery(schema, model, 'count', undefined, options);
        },

        useSuspenseCount: (options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'count', undefined, options);
        },

        useAggregate: (options?: any) => {
            return useInternalQuery(schema, model, 'aggregate', undefined, options);
        },

        useSuspenseAggregate: (options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'aggregate', undefined, options);
        },

        useGroupBy: (options?: any) => {
            return useInternalQuery(schema, model, 'groupBy', undefined, options);
        },

        useSuspenseGroupBy: (options?: any) => {
            return useInternalSuspenseQuery(schema, model, 'groupBy', undefined, options);
        },
    } as ModelQueryHooks<Schema, Model>;
}

export function useInternalQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args?: unknown,
    options?: Omit<UseQueryOptions<TQueryFnData, DefaultError, TData>, 'queryKey'> & ExtraQueryOptions,
) {
    const { endpoint, fetch } = useHooksContext();
    const reqUrl = makeUrl(endpoint, model, operation, args);
    const queryKey = getQueryKey(model, operation, args, {
        infinite: false,
        optimisticUpdate: options?.optimisticUpdate !== false,
    });
    return {
        queryKey,
        ...useQuery({
            queryKey,
            queryFn: ({ signal }) => fetcher<TQueryFnData, false>(reqUrl, { signal }, fetch, false),
            ...options,
        }),
    };
}

export function useInternalSuspenseQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args?: unknown,
    options?: Omit<UseSuspenseQueryOptions<TQueryFnData, DefaultError, TData>, 'queryKey'> & ExtraQueryOptions,
) {
    const { endpoint, fetch } = useHooksContext();
    const reqUrl = makeUrl(endpoint, model, operation, args);
    const queryKey = getQueryKey(model, operation, args, {
        infinite: false,
        optimisticUpdate: options?.optimisticUpdate !== false,
    });
    return {
        queryKey,
        ...useSuspenseQuery({
            queryKey,
            queryFn: ({ signal }) => fetcher<TQueryFnData, false>(reqUrl, { signal }, fetch, false),
            ...options,
        }),
    };
}

export function useInternalInfiniteQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args: unknown,
    options: Omit<
        UseInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
        'queryKey' | 'initialPageParam'
    >,
) {
    const { endpoint, fetch } = useHooksContext();
    const queryKey = getQueryKey(model, operation, args, { infinite: true, optimisticUpdate: false });
    return {
        queryKey,
        ...useInfiniteQuery({
            queryKey,
            queryFn: ({ pageParam, signal }) => {
                return fetcher<TQueryFnData, false>(
                    makeUrl(endpoint, model, operation, pageParam ?? args),
                    { signal },
                    fetch,
                    false,
                );
            },
            initialPageParam: args,
            ...options,
        }),
    };
}

export function useInternalSuspenseInfiniteQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args: unknown,
    options: Omit<
        UseSuspenseInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
        'queryKey' | 'initialPageParam'
    >,
) {
    const { endpoint, fetch } = useHooksContext();
    const queryKey = getQueryKey(model, operation, args, { infinite: true, optimisticUpdate: false });
    return {
        queryKey,
        ...useSuspenseInfiniteQuery({
            queryKey,
            queryFn: ({ pageParam, signal }) => {
                return fetcher<TQueryFnData, false>(
                    makeUrl(endpoint, model, operation, pageParam ?? args),
                    { signal },
                    fetch,
                    false,
                );
            },
            initialPageParam: args,
            ...options,
        }),
    };
}

/**
 * Creates a react-query mutation
 *
 * @private
 *
 * @param model The name of the model under mutation.
 * @param method The HTTP method.
 * @param operation The mutation operation (e.g. `create`).
 * @param options The react-query options.
 * @param checkReadBack Whether to check for read back errors and return undefined if found.
 */
export function useInternalMutation<
    TArgs,
    R = any,
    C extends boolean = boolean,
    Result = C extends true ? R | undefined : R,
>(
    schema: SchemaDef,
    model: string,
    method: 'POST' | 'PUT' | 'DELETE',
    operation: string,
    options?: Omit<UseMutationOptions<Result, DefaultError, TArgs>, 'mutationFn'> & ExtraMutationOptions,
    checkReadBack?: C,
) {
    const { endpoint, fetch } = useHooksContext();
    const queryClient = useQueryClient();
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
        return fetcher<R, C>(reqUrl, fetchInit, fetch, checkReadBack) as Promise<Result>;
    };

    const finalOptions = { ...options, mutationFn };
    const invalidateQueries = options?.invalidateQueries !== false;
    const optimisticUpdate = !!options?.optimisticUpdate;

    if (operation) {
        const { logging } = useContext(QuerySettingsContext);
        if (invalidateQueries) {
            setupInvalidation(
                model,
                operation,
                schema,
                finalOptions,
                (predicate) => queryClient.invalidateQueries({ predicate }),
                logging,
            );
        }

        if (optimisticUpdate) {
            setupOptimisticUpdate(
                model,
                operation,
                schema,
                finalOptions,
                queryClient.getQueryCache().getAll(),
                (queryKey, data) => {
                    // update query cache
                    queryClient.setQueryData<unknown>(queryKey, data);
                    // cancel on-flight queries to avoid redundant cache updates,
                    // the settlement of the current mutation will trigger a new revalidation
                    queryClient.cancelQueries({ queryKey }, { revert: false, silent: true });
                },
                invalidateQueries ? (predicate) => queryClient.invalidateQueries({ predicate }) : undefined,
                logging,
            );
        }
    }

    return useMutation(finalOptions);
}
