import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
    type DefaultError,
    type InfiniteData,
    type QueryKey,
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
    SelectSubset,
    SimplifiedModelResult,
    Subset,
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
import type { TrimDelegateModelOperations, WithOptimistic } from './utils/types';

export type { FetchFn } from './utils/common';

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
 * @deprecated Use {@link QuerySettingsProvider} instead.
 */
export const Provider = QuerySettingsProvider;

function useHooksContext() {
    const { endpoint, ...rest } = useContext(QuerySettingsContext);
    return { endpoint: endpoint ?? DEFAULT_QUERY_ENDPOINT, ...rest };
}

export type ModelQueryOptions<T> = Omit<UseQueryOptions<T, DefaultError>, 'queryKey'> & ExtraQueryOptions;

export type ModelQueryResult<T> = UseQueryResult<WithOptimistic<T>, DefaultError> & { queryKey: QueryKey };

export type ModelSuspenseQueryOptions<T> = Omit<UseSuspenseQueryOptions<T, DefaultError>, 'queryKey'> &
    ExtraQueryOptions;

export type ModelSuspenseQueryResult<T> = UseSuspenseQueryResult<WithOptimistic<T>, DefaultError> & {
    queryKey: QueryKey;
};

export type ModelInfiniteQueryOptions<T> = Omit<
    UseInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
>;

export type ModelInfiniteQueryResult<T> = UseInfiniteQueryResult<T, DefaultError> & { queryKey: QueryKey };

export type ModelSuspenseInfiniteQueryOptions<T> = Omit<
    UseSuspenseInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
>;

export type ModelSuspenseInfiniteQueryResult<T> = UseSuspenseInfiniteQueryResult<T, DefaultError> & {
    queryKey: QueryKey;
};

export type ModelMutationOptions<T, TArgs> = Omit<UseMutationOptions<T, DefaultError, TArgs>, 'mutationFn'> &
    ExtraMutationOptions;

export type ModelMutationResult<T, TArgs> = UseMutationResult<T, DefaultError, TArgs>;

export type ModelMutationModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    TArgs,
    Array extends boolean = false,
> = Omit<ModelMutationResult<SimplifiedModelResult<Schema, Model, TArgs, false, Array>, TArgs>, 'mutateAsync'> & {
    mutateAsync<T extends TArgs>(
        args: T,
        options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T, false, Array>, T>,
    ): Promise<SimplifiedModelResult<Schema, Model, T, false, Array>>;
};

export type ClientHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as `${Uncapitalize<Model>}`]: ModelQueryHooks<Schema, Model>;
};

// Note that we can potentially use TypeScript's mapped type to directly map from ORM contract, but that seems
// to significantly slow down tsc performance ...
export type ModelQueryHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = TrimDelegateModelOperations<
    Schema,
    Model,
    {
        useFindUnique<T extends FindUniqueArgs<Schema, Model>>(
            args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedModelResult<Schema, Model, T> | null>,
        ): ModelQueryResult<SimplifiedModelResult<Schema, Model, T> | null>;

        useSuspenseFindUnique<T extends FindUniqueArgs<Schema, Model>>(
            args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<SimplifiedModelResult<Schema, Model, T> | null>,
        ): ModelSuspenseQueryResult<SimplifiedModelResult<Schema, Model, T> | null>;

        useFindFirst<T extends FindFirstArgs<Schema, Model>>(
            args?: SelectSubset<T, FindFirstArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedModelResult<Schema, Model, T> | null>,
        ): ModelQueryResult<SimplifiedModelResult<Schema, Model, T> | null>;

        useSuspenseFindFirst<T extends FindFirstArgs<Schema, Model>>(
            args?: SelectSubset<T, FindFirstArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<SimplifiedModelResult<Schema, Model, T> | null>,
        ): ModelSuspenseQueryResult<SimplifiedModelResult<Schema, Model, T> | null>;

        useFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelQueryOptions<SimplifiedModelResult<Schema, Model, T>[]>,
        ): ModelQueryResult<SimplifiedModelResult<Schema, Model, T>[]>;

        useSuspenseFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<SimplifiedModelResult<Schema, Model, T>[]>,
        ): ModelSuspenseQueryResult<SimplifiedModelResult<Schema, Model, T>[]>;

        useInfiniteFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelInfiniteQueryOptions<SimplifiedModelResult<Schema, Model, T>[]>,
        ): ModelInfiniteQueryResult<InfiniteData<SimplifiedModelResult<Schema, Model, T>[]>>;

        useSuspenseInfiniteFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: SelectSubset<T, FindManyArgs<Schema, Model>>,
            options?: ModelSuspenseInfiniteQueryOptions<SimplifiedModelResult<Schema, Model, T>[]>,
        ): ModelSuspenseInfiniteQueryResult<InfiniteData<SimplifiedModelResult<Schema, Model, T>[]>>;

        useCreate<T extends CreateArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>, T>,
        ): ModelMutationModelResult<Schema, Model, T>;

        useCreateMany<T extends CreateManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useCreateManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>[], T>,
        ): ModelMutationModelResult<Schema, Model, T, true>;

        useUpdate<T extends UpdateArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>, T>,
        ): ModelMutationModelResult<Schema, Model, T>;

        useUpdateMany<T extends UpdateManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useUpdateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>[], T>,
        ): ModelMutationModelResult<Schema, Model, T, true>;

        useUpsert<T extends UpsertArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>, T>,
        ): ModelMutationModelResult<Schema, Model, T>;

        useDelete<T extends DeleteArgs<Schema, Model>>(
            options?: ModelMutationOptions<SimplifiedModelResult<Schema, Model, T>, T>,
        ): ModelMutationModelResult<Schema, Model, T>;

        useDeleteMany<T extends DeleteManyArgs<Schema, Model>>(
            options?: ModelMutationOptions<BatchResult, T>,
        ): ModelMutationResult<BatchResult, T>;

        useCount<T extends CountArgs<Schema, Model>>(
            args?: Subset<T, CountArgs<Schema, Model>>,
            options?: ModelQueryOptions<CountResult<Schema, Model, T>>,
        ): ModelQueryResult<CountResult<Schema, Model, T>>;

        useSuspenseCount<T extends CountArgs<Schema, Model>>(
            args?: Subset<T, CountArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<CountResult<Schema, Model, T>>,
        ): ModelSuspenseQueryResult<CountResult<Schema, Model, T>>;

        useAggregate<T extends AggregateArgs<Schema, Model>>(
            args: Subset<T, AggregateArgs<Schema, Model>>,
            options?: ModelQueryOptions<AggregateResult<Schema, Model, T>>,
        ): ModelQueryResult<AggregateResult<Schema, Model, T>>;

        useSuspenseAggregate<T extends AggregateArgs<Schema, Model>>(
            args: Subset<T, AggregateArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<AggregateResult<Schema, Model, T>>,
        ): ModelSuspenseQueryResult<AggregateResult<Schema, Model, T>>;

        useGroupBy<T extends GroupByArgs<Schema, Model>>(
            args: Subset<T, GroupByArgs<Schema, Model>>,
            options?: ModelQueryOptions<GroupByResult<Schema, Model, T>>,
        ): ModelQueryResult<GroupByResult<Schema, Model, T>>;

        useSuspenseGroupBy<T extends GroupByArgs<Schema, Model>>(
            args: Subset<T, GroupByArgs<Schema, Model>>,
            options?: ModelSuspenseQueryOptions<GroupByResult<Schema, Model, T>>,
        ): ModelSuspenseQueryResult<GroupByResult<Schema, Model, T>>;
    }
>;

/**
 * Gets data query hooks for all models in the schema.
 */
export function useClientQueries<Schema extends SchemaDef>(schema: Schema): ClientHooks<Schema> {
    return Object.keys(schema.models).reduce((acc, model) => {
        (acc as any)[lowerCaseFirst(model)] = useModelQueries(schema, model as GetModels<Schema>);
        return acc;
    }, {} as ClientHooks<Schema>);
}

/**
 * Gets data query hooks for a specific model in the schema.
 */
export function useModelQueries<Schema extends SchemaDef, Model extends GetModels<Schema>>(
    schema: Schema,
    model: Model,
): ModelQueryHooks<Schema, Model> {
    const modelDef = Object.values(schema.models).find((m) => m.name.toLowerCase() === model.toLowerCase());
    if (!modelDef) {
        throw new Error(`Model "${model}" not found in schema`);
    }

    const modelName = modelDef.name;

    return {
        useFindUnique: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findUnique', args, options);
        },

        useSuspenseFindUnique: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'findUnique', args, options);
        },

        useFindFirst: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findFirst', args, options);
        },

        useSuspenseFindFirst: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'findFirst', args, options);
        },

        useFindMany: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findMany', args, options);
        },

        useSuspenseFindMany: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'findMany', args, options);
        },

        useInfiniteFindMany: (args: any, options?: any) => {
            return useInternalInfiniteQuery(schema, modelName, 'findMany', args, options);
        },

        useSuspenseInfiniteFindMany: (args: any, options?: any) => {
            return useInternalSuspenseInfiniteQuery(schema, modelName, 'findMany', args, options);
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

        useSuspenseCount: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'count', args, options);
        },

        useAggregate: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'aggregate', args, options);
        },

        useSuspenseAggregate: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'aggregate', args, options);
        },

        useGroupBy: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'groupBy', args, options);
        },

        useSuspenseGroupBy: (args: any, options?: any) => {
            return useInternalSuspenseQuery(schema, modelName, 'groupBy', args, options);
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
            queryFn: ({ signal }) => fetcher<TQueryFnData>(reqUrl, { signal }, fetch),
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
            queryFn: ({ signal }) => fetcher<TQueryFnData>(reqUrl, { signal }, fetch),
            ...options,
        }),
    };
}

export function useInternalInfiniteQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args: unknown,
    options:
        | Omit<
              UseInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
              'queryKey' | 'initialPageParam'
          >
        | undefined,
) {
    options = options ?? { getNextPageParam: () => undefined };
    const { endpoint, fetch } = useHooksContext();
    const queryKey = getQueryKey(model, operation, args, { infinite: true, optimisticUpdate: false });
    return {
        queryKey,
        ...useInfiniteQuery({
            queryKey,
            queryFn: ({ pageParam, signal }) => {
                return fetcher<TQueryFnData>(makeUrl(endpoint, model, operation, pageParam ?? args), { signal }, fetch);
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
                return fetcher<TQueryFnData>(makeUrl(endpoint, model, operation, pageParam ?? args), { signal }, fetch);
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
export function useInternalMutation<TArgs, R = any>(
    schema: SchemaDef,
    model: string,
    method: 'POST' | 'PUT' | 'DELETE',
    operation: string,
    options?: Omit<UseMutationOptions<R, DefaultError, TArgs>, 'mutationFn'> & ExtraMutationOptions,
) {
    const { endpoint, fetch, logging } = useHooksContext();
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
        return fetcher<R>(reqUrl, fetchInit, fetch) as Promise<R>;
    };

    const finalOptions = { ...options, mutationFn };
    const invalidateQueries = options?.invalidateQueries !== false;
    const optimisticUpdate = !!options?.optimisticUpdate;

    if (operation) {
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
