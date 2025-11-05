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
    FindArgs,
    FindUniqueArgs,
    GroupByArgs,
    GroupByResult,
    ModelResult,
    SelectSubset,
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
    const { endpoint, ...rest } = getContext<APIContext>(SvelteQueryContextKey);
    return { endpoint: endpoint ?? DEFAULT_QUERY_ENDPOINT, ...rest };
}

export type ModelQueryOptions<T> = Omit<CreateQueryOptions<T, DefaultError>, 'queryKey'> & ExtraQueryOptions;

export type ModelQueryResult<T> = Readable<UnwrapStore<CreateQueryResult<T, DefaultError>> & { queryKey: QueryKey }>;

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

export type SchemaHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as `${Uncapitalize<Model>}`]: ModelQueryHooks<Schema, Model>;
};

export type ModelQueryHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    useFindUnique<T extends FindUniqueArgs<Schema, Model>>(
        args: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): ModelQueryResult<ModelResult<Schema, Model, T> | null>;

    useFindFirst<T extends FindArgs<Schema, Model, false>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, false>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T> | null>,
    ): ModelQueryResult<ModelResult<Schema, Model, T> | null>;

    useFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): ModelQueryResult<ModelResult<Schema, Model, T>[]>;

    useInfiniteFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: ModelInfiniteQueryOptions<ModelResult<Schema, Model, T>[]>,
    ): ModelInfiniteQueryResult<InfiniteData<ModelResult<Schema, Model, T>[]>>;

    useCreate<T extends CreateArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useCreateMany<T extends CreateManyArgs<Schema, Model>>(
        options?: ModelMutationOptions<BatchResult, T>,
    ): ModelMutationResult<BatchResult, T>;

    useCreateManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>[], T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>[], T>;

    useUpdate<T extends UpdateArgs<Schema, Model>>(
        options?: ModelMutationOptions<ModelResult<Schema, Model, T>, T>,
    ): ModelMutationResult<ModelResult<Schema, Model, T>, T>;

    useUpdateMany<T extends UpdateManyArgs<Schema, Model>>(
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
};

/**
 * Gets data query hooks for all models in the schema.
 */
export function useClientQueries<Schema extends SchemaDef>(schema: Schema): SchemaHooks<Schema> {
    return Object.keys(schema.models).reduce((acc, model) => {
        (acc as any)[lowerCaseFirst(model)] = useModelQueries(schema, model as GetModels<Schema>);
        return acc;
    }, {} as SchemaHooks<Schema>);
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
            return useInternalMutation(schema, modelName, 'POST', 'create', options, true);
        },

        useCreateMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'createMany', options, false);
        },

        useCreateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'createManyAndReturn', options, true);
        },

        useUpdate: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'update', options, true);
        },

        useUpdateMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'updateMany', options, false);
        },

        useUpdateManyAndReturn: (options?: any) => {
            return useInternalMutation(schema, modelName, 'PUT', 'updateManyAndReturn', options, true);
        },

        useUpsert: (options?: any) => {
            return useInternalMutation(schema, modelName, 'POST', 'upsert', options, true);
        },

        useDelete: (options?: any) => {
            return useInternalMutation(schema, modelName, 'DELETE', 'delete', options, true);
        },

        useDeleteMany: (options?: any) => {
            return useInternalMutation(schema, modelName, 'DELETE', 'deleteMany', options, false);
        },

        useCount: (options?: any) => {
            return useInternalQuery(schema, modelName, 'count', undefined, options);
        },

        useAggregate: (options?: any) => {
            return useInternalQuery(schema, modelName, 'aggregate', undefined, options);
        },

        useGroupBy: (options?: any) => {
            return useInternalQuery(schema, modelName, 'groupBy', undefined, options);
        },
    } as ModelQueryHooks<Schema, Model>;
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
        fetcher<TQueryFnData, false>(reqUrl, { signal }, fetch, false);

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
    options: StoreOrVal<
        Omit<
            CreateInfiniteQueryOptions<TQueryFnData, DefaultError, InfiniteData<TData>>,
            'queryKey' | 'initialPageParam'
        >
    >,
) {
    const { endpoint, fetch } = getQuerySettings();
    const argsValue = unwrapStore(args);
    const queryKey = getQueryKey(model, operation, argsValue, { infinite: true, optimisticUpdate: false });
    const queryFn: QueryFunction<TQueryFnData, QueryKey, unknown> = ({ pageParam, signal }) =>
        fetcher<TQueryFnData, false>(
            makeUrl(endpoint, model, operation, pageParam ?? argsValue),
            { signal },
            fetch,
            false,
        );

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
    options?: StoreOrVal<Omit<CreateMutationOptions<Result, DefaultError, TArgs>, 'mutationFn'> & ExtraMutationOptions>,
    checkReadBack?: C,
) {
    const { endpoint, fetch } = getQuerySettings();
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
        return fetcher<R, C>(reqUrl, fetchInit, fetch, checkReadBack) as Promise<Result>;
    };

    let mergedOpt: StoreOrVal<CreateMutationOptions<Result, DefaultError, TArgs>>;

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
        const { logging } = getContext<APIContext>(SvelteQueryContextKey);
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
