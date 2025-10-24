import {
    useMutation,
    useQuery,
    type DefaultError,
    type UseMutationOptions,
    type UseMutationResult,
    type UseQueryOptions,
    type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateArgs, FindArgs, ModelResult, SelectSubset } from '@zenstackhq/runtime';
import { type GetModels, type SchemaDef } from '@zenstackhq/runtime/schema';
import { useContext } from 'react';
import { getQueryKey, type MutationMethod, type MutationOperation, type QueryOperation } from './runtime/common';
import { RequestHandlerContext } from './runtime/react';

export type useHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as Uncapitalize<Model>]: UseModelHooks<Schema, Model>;
};

type UseModelHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    useFindFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<UseQueryOptions<ModelResult<Schema, Model, T>[]>, 'queryKey' | 'queryFn'>,
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    useCreate<T extends CreateArgs<Schema, Model>>(
        options?: UseMutationOptions<ModelResult<Schema, Model, T>, DefaultError, T>,
    ): UseMutationResult<ModelResult<Schema, Model, T>, DefaultError, T>;
};

function uncapitalize(s: string) {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

export function useHooks<Schema extends SchemaDef>(schema: Schema): useHooks<Schema> {
    return Object.entries(schema.models).reduce(
        (acc, [model, _]) =>
            Object.assign(acc, {
                [uncapitalize(model)]: useModelHooks(schema, model as GetModels<Schema>),
            }),
        {} as useHooks<Schema>,
    );
}

function useModelHooks<Schema extends SchemaDef, Model extends GetModels<Schema>>(schema: Schema, model: Model): any {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return {
        useFindFirst: useModelQuery(schema, model, 'findFirst'),
        useCreate: useModelMutation(schema, model, 'create', 'POST'),
    };
}

export function useModelQuery<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
>(
    schema: Schema,
    model: Model,
    operation: QueryOperation,
) {
    const context = useContext(RequestHandlerContext);
    if (!context) {
        throw new Error('Missing context');
    }

    const queryKey = getQueryKey(schema, model, operation, {});
    const query = useQuery({
        queryKey,
        queryFn: async () => {
            const response = await context.fetch!(context.endpoint!);

            return response;
        },
    });

    return query;
}

export function useModelMutation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
>(
    schema: Schema,
    model: Model,
    operation: MutationOperation,
    method: MutationMethod,
) {
    const context = useContext(RequestHandlerContext);
    if (!context) {
        throw new Error('Missing context');
    }

    const mutation = useMutation({
        mutationFn: async () => {
            const response = await context.fetch!(context.endpoint!, {
                method,
            });

            return response;
        }
    });

    return mutation;
}