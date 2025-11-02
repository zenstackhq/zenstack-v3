import type {
    DefaultError,
    UseMutationOptions,
    UseMutationResult,
    UseQueryOptions,
    UseQueryResult,
} from '@tanstack/react-query';
import { lowerCaseFirst } from '@zenstackhq/common-helpers';
import type { CreateArgs, FindArgs, ModelResult, SelectSubset } from '@zenstackhq/orm';
import type { GetModels, SchemaDef } from '@zenstackhq/orm/schema';

export type QueryHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as Uncapitalize<Model>]: ModelQueryHooks<Schema, Model>;
};

type ModelQueryHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    useFindMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<UseQueryOptions<ModelResult<Schema, Model, T>[]>, 'queryKey'>,
    ): UseQueryResult<ModelResult<Schema, Model, T>[]>;

    useFindFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<UseQueryOptions<ModelResult<Schema, Model, T>[]>, 'queryKey'>,
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    useCreate<T extends CreateArgs<Schema, Model>>(
        options?: UseMutationOptions<ModelResult<Schema, Model, T>, DefaultError, T>,
    ): UseMutationResult<ModelResult<Schema, Model, T>, DefaultError, T>;
};

export function useQueryHooks<Schema extends SchemaDef>(schema: Schema): QueryHooks<Schema> {
    return Object.entries(schema.models).reduce(
        (acc, [model, _]) =>
            Object.assign(acc, {
                [lowerCaseFirst(model)]: toModelHooks(schema, model as GetModels<Schema>),
            }),
        {} as QueryHooks<Schema>,
    );
}

function toModelHooks<Schema extends SchemaDef, Model extends GetModels<Schema>>(
    schema: Schema,
    model: Model,
): ModelQueryHooks<Schema, Model> {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return {
        useFindMany: () => {
            return {
                data: [],
                isLoading: false,
                isError: false,
            };
        },

        findFirst: () => {
            return {
                data: null,
                isLoading: false,
                isError: false,
            };
        },

        create: () => {
            return {
                mutate: async () => {
                    return null;
                },
                isLoading: false,
                isError: false,
            };
        },
    };
}
