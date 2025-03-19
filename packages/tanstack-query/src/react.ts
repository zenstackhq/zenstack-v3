import type {
    DefaultError,
    UseMutationOptions,
    UseMutationResult,
    UseQueryOptions,
    UseQueryResult,
} from '@tanstack/react-query';
import type {
    CreateArgs,
    FindArgs,
    ModelResult,
    SelectSubset,
} from '@zenstackhq/runtime/client';
import type { GetModels, SchemaDef } from '@zenstackhq/runtime/schema';

export type toHooks<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as Uncapitalize<Model>]: ToModelHooks<
        Schema,
        Model
    >;
};

type ToModelHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    findMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<
            UseQueryOptions<ModelResult<Schema, Model, T>[]>,
            'queryKey'
        >
    ): UseQueryResult<ModelResult<Schema, Model, T>[]>;

    findFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
        options?: Omit<
            UseQueryOptions<ModelResult<Schema, Model, T>[]>,
            'queryKey'
        >
    ): UseQueryResult<ModelResult<Schema, Model, T> | null>;

    create<T extends CreateArgs<Schema, Model>>(
        options?: UseMutationOptions<
            ModelResult<Schema, Model, T>,
            DefaultError,
            T
        >
    ): UseMutationResult<ModelResult<Schema, Model, T>, DefaultError, T>;
};

function uncapitalize(s: string) {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

export function toHooks<Schema extends SchemaDef>(
    schema: Schema
): toHooks<Schema> {
    return Object.entries(schema.models).reduce(
        (acc, [model, _]) =>
            Object.assign(acc, {
                [uncapitalize(model)]: toModelHooks(
                    schema,
                    model as GetModels<Schema>
                ),
            }),
        {} as toHooks<Schema>
    );
}

function toModelHooks<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(schema: Schema, model: Model): any {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }

    return {
        findMany: () => {
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
