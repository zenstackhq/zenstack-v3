/* eslint-disable @typescript-eslint/no-unused-vars */
import {
    useMutation,
    useQuery,
    type DefaultError,
    type UseMutationOptions,
    type UseMutationResult,
    type UseQueryOptions,
    type UseQueryResult,
} from '@tanstack/react-query';
import { type CreateArgs, type FindArgs, type ModelResult, type SelectSubset } from '@zenstackhq/runtime';
import { type GetModels, type SchemaDef } from '@zenstackhq/runtime/schema';
import { useContext } from 'react';
import { getQueryKey, type MutationMethod, type MutationOperation, type OperationArgs, type OperationResult, type QueryOperation } from './runtime/common';
import { RequestHandlerContext } from './runtime/react';

export type useHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as Uncapitalize<Model>]: UseModelHooks<Schema, Model>;
};

export type UseModelHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    useFindFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<UseQueryOptions<ModelResult<Schema, Model, T>[]>, 'queryKey' | 'queryFn'>,
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    // useCreate<T extends CreateArgs<Schema, Model>>(
    //     options?: Omit<UseMutationOptions<ModelResult<Schema, Model, T>, DefaultError, T>, 'mutationFn'>,
    // ): UseMutationResult<ModelResult<Schema, Model, T>, DefaultError, T>;
};

function uncapitalize(s: string) {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

export function useHooks<Schema extends SchemaDef>(schema: Schema): useHooks<Schema> {
    return Object.entries(schema.models).reduce(
        (acc, [model]) =>
            Object.assign(acc, {
                [uncapitalize(model)]: useModelHooks(schema, model as GetModels<Schema>),
            }),
        {} as useHooks<Schema>,
    );
}

export function useModelHooks<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
>(
    schema: Schema,
    model: Model,
): UseModelHooks<Schema, Model> {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return {
        useFindFirst: <T extends FindArgs<Schema, Model, true>>(
            args: SelectSubset<T, FindArgs<Schema, Model, true>>,
            options?: Omit<UseQueryOptions<ModelResult<Schema, Model, T>[]>, 'queryKey' | 'queryFn'>,
        ) => {
            return useModelQuery(schema, model, 'findFirst', args);
        },

        // useCreate: <T extends CreateArgs<Schema, Model>>(
        //     options?: Omit<UseMutationOptions<ModelResult<Schema, Model, T>, DefaultError, T>, 'mutationFn'>,
        // ) => {
        //     return useModelMutation(schema, model, 'create', 'POST');
        // },
    }
}

export type ModelQuery<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends QueryOperation,
    Result extends OperationResult<Schema, Model, Operation>,
> = UseQueryResult<Result, DefaultError>

export function useModelQuery<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends QueryOperation,
    Args extends OperationArgs<Schema, Model, Operation>,
    Result extends OperationResult<Schema, Model, Operation>,
>(
    schema: Schema,
    model: Model,
    operation: Operation,
    args: Args,
) {
    const context = useContext(RequestHandlerContext);
    if (!context) {
        throw new Error('Missing context');
    }

    const queryKey = getQueryKey(schema, model, operation, args);
    const argsQuery = encodeURIComponent(JSON.stringify(args));
    const query = useQuery<unknown, DefaultError, Result>({
        queryKey,
        queryFn: async () => {
            const response = await context.fetch!(context.endpoint!);

            return response as unknown as Result;
        },
    });

    return query;
}

export type ModelMutation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends MutationOperation,
    Args extends OperationArgs<Schema, Model, Operation>,
    Result extends OperationResult<Schema, Model, Operation>,
> = UseMutationResult<Result, DefaultError, Args, unknown>;

export function useModelMutation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends MutationOperation,
    Args extends OperationArgs<Schema, Model, Operation>,
    Result extends OperationResult<Schema, Model, Operation>,
>(
    schema: Schema,
    model: Model,
    operation: Operation,
    method: MutationMethod,
): ModelMutation<Schema, Model, Operation, Args, Result> {
    const context = useContext(RequestHandlerContext);
    if (!context) {
        throw new Error('Missing context');
    }

    const mutation = useMutation<Result, DefaultError, Args>({
        mutationFn: async () => {
            const response = await context.fetch!(context.endpoint!, {
                method,
            });

            return response as unknown as Result;
        }
    });

    return mutation;
}