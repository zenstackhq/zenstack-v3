import {
    createInfiniteQuery,
    createMutation,
    createQuery,
    useQueryClient,
    type Accessor,
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
} from '@tanstack/svelte-query';
import {
    createInvalidator,
    createOptimisticUpdater,
    DEFAULT_QUERY_ENDPOINT,
    type InvalidationPredicate,
} from '@zenstackhq/client-helpers';
import { fetcher, makeUrl, marshal } from '@zenstackhq/client-helpers/fetch';
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
import { getAllQueries, invalidateQueriesMatchingPredicate } from '../common/client';
import { getQueryKey } from '../common/query-key';
import type {
    CustomOperationDefinition,
    ExtraMutationOptions,
    ExtraQueryOptions,
    QueryContext,
    TrimDelegateModelOperations,
    WithOptimistic,
} from '../common/types';
export type { FetchFn } from '@zenstackhq/client-helpers/fetch';

/**
 * Key for setting and getting the global query context.
 */
export const SvelteQueryContextKey = 'zenstack-svelte-query-context';

/**
 * Set context for query settings.
 *
 * @deprecated use {@link setQuerySettingsContext} instead.
 */
export function setHooksContext(context: QueryContext) {
    setContext(SvelteQueryContextKey, context);
}

/**
 * Set context for query settings.
 */
export function setQuerySettingsContext(context: QueryContext) {
    setContext(SvelteQueryContextKey, context);
}

function useQuerySettings() {
    const { endpoint, ...rest } = getContext<QueryContext>(SvelteQueryContextKey) ?? {};
    return { endpoint: endpoint ?? DEFAULT_QUERY_ENDPOINT, ...rest };
}

export type ModelQueryOptions<T> = Omit<CreateQueryOptions<T, DefaultError>, 'queryKey'> & ExtraQueryOptions;

export type ModelQueryResult<T> = CreateQueryResult<WithOptimistic<T>, DefaultError> & { queryKey: QueryKey };

export type ModelInfiniteQueryOptions<T> = Omit<
    CreateInfiniteQueryOptions<T, DefaultError, InfiniteData<T>>,
    'queryKey' | 'initialPageParam'
> &
    QueryContext;

export type ModelInfiniteQueryResult<T> = CreateInfiniteQueryResult<T, DefaultError> & {
    queryKey: QueryKey;
};

export type ModelMutationOptions<T, TArgs> = Omit<CreateMutationOptions<T, DefaultError, TArgs>, 'mutationFn'> &
    ExtraMutationOptions;

export type ModelMutationResult<T, TArgs> = CreateMutationResult<T, DefaultError, TArgs>;

export type ModelMutationModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    TArgs,
    Array extends boolean = false,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
> = Omit<ModelMutationResult<SimplifiedResult<Schema, Model, TArgs, Options, false, Array>, TArgs>, 'mutateAsync'> & {
    mutateAsync<T extends TArgs>(
        args: T,
        options?: ModelMutationOptions<SimplifiedResult<Schema, Model, T, Options, false, Array>, T>,
    ): Promise<SimplifiedResult<Schema, Model, T, Options, false, Array>>;
};

type CustomOperationHooks<CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {}> = {
    [K in keyof CustomOperations as `use${Capitalize<string & K>}`]: CustomOperations[K] extends CustomOperationDefinition<
        infer TArgs,
        infer TResult
    >
        ? CustomOperations[K]['kind'] extends 'mutation'
            ? (options?: ModelMutationOptions<TResult, TArgs>) => ModelMutationResult<TResult, TArgs>
            : CustomOperations[K]['kind'] extends 'infiniteQuery' | 'suspenseInfiniteQuery'
              ? (args?: TArgs, options?: ModelInfiniteQueryOptions<TResult>) => ModelInfiniteQueryResult<TResult>
              : (args?: TArgs, options?: ModelQueryOptions<TResult>) => ModelQueryResult<TResult>
        : never;
};

export type ClientHooks<
    Schema extends SchemaDef,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
    CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {},
> = {
    [Model in GetModels<Schema> as `${Uncapitalize<Model>}`]: ModelQueryHooks<
        Schema,
        Model,
        Options,
        CustomOperations
    >;
};

// Note that we can potentially use TypeScript's mapped type to directly map from ORM contract, but that seems
// to significantly slow down tsc performance ...
export type ModelQueryHooks<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
    CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {},
> = TrimDelegateModelOperations<
    Schema,
    Model,
    {
        useFindUnique<T extends FindUniqueArgs<Schema, Model>>(
            args: Accessor<SelectSubset<T, FindUniqueArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options> | null>>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options> | null>;

        useFindFirst<T extends FindFirstArgs<Schema, Model>>(
            args?: Accessor<SelectSubset<T, FindFirstArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options> | null>>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options> | null>;

        useFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: Accessor<SelectSubset<T, FindManyArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options>[]>>,
        ): ModelQueryResult<SimplifiedPlainResult<Schema, Model, T, Options>[]>;

        useInfiniteFindMany<T extends FindManyArgs<Schema, Model>>(
            args?: Accessor<SelectSubset<T, FindManyArgs<Schema, Model>>>,
            options?: Accessor<ModelInfiniteQueryOptions<SimplifiedPlainResult<Schema, Model, T, Options>[]>>,
        ): ModelInfiniteQueryResult<InfiniteData<SimplifiedPlainResult<Schema, Model, T, Options>[]>>;

        useCreate<T extends CreateArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;

        useCreateMany<T extends CreateManyArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<BatchResult, T>>,
        ): ModelMutationResult<BatchResult, T>;

        useCreateManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>[], T>>,
        ): ModelMutationModelResult<Schema, Model, T, true, Options>;

        useUpdate<T extends UpdateArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;
        useUpdateMany<T extends UpdateManyArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<BatchResult, T>>,
        ): ModelMutationResult<BatchResult, T>;

        useUpdateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>[], T>>,
        ): ModelMutationModelResult<Schema, Model, T, true, Options>;

        useUpsert<T extends UpsertArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;
        useDelete<T extends DeleteArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<SimplifiedPlainResult<Schema, Model, T, Options>, T>>,
        ): ModelMutationModelResult<Schema, Model, T, false, Options>;

        useDeleteMany<T extends DeleteManyArgs<Schema, Model>>(
            options?: Accessor<ModelMutationOptions<BatchResult, T>>,
        ): ModelMutationResult<BatchResult, T>;

        useCount<T extends CountArgs<Schema, Model>>(
            args?: Accessor<Subset<T, CountArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<CountResult<Schema, Model, T>>>,
        ): ModelQueryResult<CountResult<Schema, Model, T>>;

        useAggregate<T extends AggregateArgs<Schema, Model>>(
            args: Accessor<Subset<T, AggregateArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<AggregateResult<Schema, Model, T>>>,
        ): ModelQueryResult<AggregateResult<Schema, Model, T>>;

        useGroupBy<T extends GroupByArgs<Schema, Model>>(
            args: Accessor<Subset<T, GroupByArgs<Schema, Model>>>,
            options?: Accessor<ModelQueryOptions<GroupByResult<Schema, Model, T>>>,
        ): ModelQueryResult<GroupByResult<Schema, Model, T>>;
    } & CustomOperationHooks<CustomOperations>
>;

/**
 * Gets data query hooks for all models in the schema.
 */
export function useClientQueries<
    Schema extends SchemaDef,
    Options extends QueryOptions<Schema> = QueryOptions<Schema>,
    CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {},
>(
    schema: Schema,
    options?: Accessor<QueryContext>,
    customOperations?: CustomOperations,
): ClientHooks<Schema, Options, CustomOperations> {
    return Object.keys(schema.models).reduce(
        (acc, model) => {
            (acc as any)[lowerCaseFirst(model)] = useModelQueries<
                Schema,
                GetModels<Schema>,
                Options,
                CustomOperations
            >(
                schema,
                model as GetModels<Schema>,
                options,
                customOperations,
            );
            return acc;
        },
        {} as ClientHooks<Schema, Options, CustomOperations>,
    );
}

/**
 * Gets data query hooks for a specific model in the schema.
 */
export function useModelQueries<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Options extends QueryOptions<Schema>,
    CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {},
>(
    schema: Schema,
    model: Model,
    rootOptions?: Accessor<QueryContext>,
    customOperations?: CustomOperations,
): ModelQueryHooks<Schema, Model, Options, CustomOperations> {
    const modelDef = Object.values(schema.models).find((m) => m.name.toLowerCase() === model.toLowerCase());
    if (!modelDef) {
        throw new Error(`Model "${model}" not found in schema`);
    }

    const modelName = modelDef.name;

    const merge = (rootOpt: unknown, opt: unknown): Accessor<any> => {
        return () => {
            const rootOptVal = typeof rootOpt === 'function' ? rootOpt() : rootOpt;
            const optVal = typeof opt === 'function' ? opt() : opt;
            return { ...rootOptVal, ...optVal };
        };
    };

    const builtIns = {
        useFindUnique: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findUnique', args, merge(rootOptions, options));
        },

        useFindFirst: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findFirst', args, merge(rootOptions, options));
        },

        useFindMany: (args: any, options?: any) => {
            return useInternalQuery(schema, modelName, 'findMany', args, merge(rootOptions, options));
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
    } as unknown as ModelQueryHooks<Schema, Model, Options>;

    const custom = createCustomOperationHooks(schema, modelName, rootOptions, customOperations, merge);

    return { ...builtIns, ...custom } as ModelQueryHooks<Schema, Model, Options, CustomOperations>;
}

function createCustomOperationHooks<
    Schema extends SchemaDef,
    CustomOperations extends Record<string, CustomOperationDefinition<any, any>> = {},
>(
    schema: Schema,
    modelName: string,
    rootOptions: Accessor<QueryContext> | undefined,
    customOperations: CustomOperations | undefined,
    mergeOptions: (rootOpt: unknown, opt: unknown) => Accessor<any>,
) {
    if (!customOperations) {
        return {} as CustomOperationHooks<CustomOperations>;
    }

    const hooks: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(customOperations)) {
        const hookName = `use${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        const merged = (options?: unknown) => mergeOptions(rootOptions, options);

        switch (def.kind) {
            case 'query':
            case 'suspenseQuery':
                hooks[hookName] = (args?: unknown, options?: unknown) =>
                    useInternalQuery(schema, modelName, name, args, merged(options as Accessor<unknown> | undefined));
                break;
            case 'infiniteQuery':
            case 'suspenseInfiniteQuery':
                hooks[hookName] = (args?: unknown, options?: unknown) => {
                    const mergedOptions = merged(options as Accessor<unknown> | undefined);
                    const withDefault = () => {
                        const value = mergedOptions?.() as any;
                        if (value && typeof value.getNextPageParam !== 'function') {
                            value.getNextPageParam = () => undefined;
                        }
                        return value;
                    };
                    return useInternalInfiniteQuery(schema, modelName, name, args, withDefault as any);
                };
                break;
            case 'mutation':
                hooks[hookName] = (options?: unknown) =>
                    useInternalMutation(
                        schema,
                        modelName,
                        (def.method ?? 'POST') as any,
                        name,
                        merged(options as Accessor<unknown> | undefined) as any,
                    );
                break;
            default:
                break;
        }
    }

    return hooks as CustomOperationHooks<CustomOperations>;
}

export function useInternalQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args?: Accessor<unknown>,
    options?: Accessor<Omit<CreateQueryOptions<TQueryFnData, DefaultError, TData>, 'queryKey'> & ExtraQueryOptions>,
) {
    const { endpoint, fetch } = useFetchOptions(options);

    const queryKey = $derived(
        getQueryKey(model, operation, args?.(), {
            infinite: false,
            optimisticUpdate: options?.().optimisticUpdate !== false,
        }),
    );

    const finalOptions = () => {
        const reqUrl = makeUrl(endpoint, model, operation, args?.());
        const queryFn: QueryFunction<TQueryFnData, QueryKey, unknown> = ({ signal }) =>
            fetcher<TQueryFnData>(reqUrl, { signal }, fetch);
        return {
            queryKey,
            queryFn,
            ...options?.(),
        };
    };

    const query = createQuery<TQueryFnData, DefaultError, TData>(finalOptions);
    // svelte-ignore state_referenced_locally
    return createQueryResult(query, queryKey);
}

export function useInternalInfiniteQuery<TQueryFnData, TData>(
    _schema: SchemaDef,
    model: string,
    operation: string,
    args: Accessor<unknown>,
    options?: Accessor<
        Omit<
            CreateInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
            'queryKey' | 'initialPageParam'
        > &
            QueryContext
    >,
) {
    const { endpoint, fetch } = useFetchOptions(options);

    const queryKey = $derived(getQueryKey(model, operation, args(), { infinite: true, optimisticUpdate: false }));

    const finalOptions = () => {
        const queryFn: QueryFunction<TQueryFnData, QueryKey, unknown> = ({ pageParam, signal }) =>
            fetcher<TQueryFnData>(makeUrl(endpoint, model, operation, pageParam ?? args()), { signal }, fetch);
        const optionsValue = options?.() ?? { getNextPageParam: () => undefined };
        return {
            queryKey,
            queryFn,
            initialPageParam: args(),
            ...optionsValue,
        };
    };

    const query = createInfiniteQuery<TQueryFnData, DefaultError, InfiniteData<TData>>(finalOptions);
    // svelte-ignore state_referenced_locally
    return createQueryResult(query, queryKey);
}

function createQueryResult<T>(query: T, queryKey: QueryKey): T & { queryKey: QueryKey } {
    // CHECKME: is there a better way to do this?
    // create a proxy object that properly forwards all properties while adding queryKey,
    // this preserves svelte-query reactivity by using getters
    return new Proxy(query as any, {
        get(target, prop) {
            if (prop === 'queryKey') {
                return queryKey;
            }
            return target[prop];
        },
    });
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
    options?: Accessor<Omit<CreateMutationOptions<R, DefaultError, TArgs>, 'mutationFn'> & ExtraMutationOptions>,
) {
    const { endpoint, fetch, logging } = useQuerySettings();
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

    const finalOptions = () => {
        const optionsValue = options?.();
        const invalidateQueries = optionsValue?.invalidateQueries !== false;
        const optimisticUpdate = !!optionsValue?.optimisticUpdate;
        const result = {
            ...optionsValue,
            mutationFn,
        };

        if (!optimisticUpdate) {
            // if optimistic update is not enabled, invalidate related queries on success
            if (invalidateQueries) {
                const invalidator = createInvalidator(
                    model,
                    operation,
                    schema,
                    (predicate: InvalidationPredicate) =>
                        // @ts-ignore
                        invalidateQueriesMatchingPredicate(queryClient, predicate),
                    logging,
                );

                // execute invalidator prior to user-provided onSuccess
                const origOnSuccess = optionsValue?.onSuccess;
                const wrappedOnSuccess: typeof origOnSuccess = async (...args) => {
                    await invalidator(...args);
                    await origOnSuccess?.(...args);
                };
                result.onSuccess = wrappedOnSuccess;
            }
        } else {
            const optimisticUpdater = createOptimisticUpdater(
                model,
                operation,
                schema,
                { optimisticDataProvider: optionsValue?.optimisticDataProvider },
                // @ts-ignore
                () => getAllQueries(queryClient),
                logging,
            );

            const origOnMutate = optionsValue.onMutate;
            const wrappedOnMutate: typeof origOnMutate = async (...args) => {
                // execute optimistic updater prior to user-provided onMutate
                await optimisticUpdater(...args);

                // call user-provided onMutate
                return origOnMutate?.(...args);
            };

            result.onMutate = wrappedOnMutate;

            if (invalidateQueries) {
                const invalidator = createInvalidator(
                    model,
                    operation,
                    schema,
                    (predicate: InvalidationPredicate) =>
                        // @ts-ignore
                        invalidateQueriesMatchingPredicate(queryClient, predicate),
                    logging,
                );
                const origOnSettled = optionsValue.onSettled;
                const wrappedOnSettled: typeof origOnSettled = async (...args) => {
                    // execute invalidator prior to user-provided onSettled
                    await invalidator(...args);

                    // call user-provided onSettled
                    await origOnSettled?.(...args);
                };

                // replace onSettled in mergedOpt
                result.onSettled = wrappedOnSettled;
            }
        }

        return result;
    };
    return createMutation(finalOptions);
}

function useFetchOptions(options: Accessor<QueryContext> | undefined) {
    const { endpoint, fetch, logging } = useQuerySettings();
    const optionsValue = options?.();
    // options take precedence over context
    return {
        endpoint: optionsValue?.endpoint ?? endpoint,
        fetch: optionsValue?.fetch ?? fetch,
        logging: optionsValue?.logging ?? logging,
    };
}
