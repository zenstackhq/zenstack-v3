import type { OperationNode, QueryResult, RootOperationNode, UnknownRow } from 'kysely';
import type { ClientContract, ToKysely } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { MaybePromise } from '../utils/type-utils';
import type { ModelOperations } from './contract';
import type { CrudOperation } from './crud/operations/base';

export type QueryContext<Schema extends SchemaDef> = {
    /**
     * The ZenStack client that's invoking the plugin.
     */
    client: ClientContract<Schema>;

    /**
     * The model that is being queried.
     */
    model: GetModels<Schema>;

    /**
     * The query operation that is being performed.
     */
    operation: CrudOperation;

    /**
     * The query arguments.
     */
    queryArgs: unknown;
};

/**
 * The result of the hooks interception filter.
 */
export type MutationInterceptionFilterResult = {
    /**
     * Whether to intercept the mutation or not.
     */
    intercept: boolean;

    /**
     * Whether entities should be loaded before the mutation.
     */
    loadBeforeMutationEntity?: boolean;

    /**
     * Whether entities should be loaded after the mutation.
     */
    loadAfterMutationEntity?: boolean;
};

type MutationHooksArgs<Schema extends SchemaDef> = {
    /**
     * The model that is being mutated.
     */
    model: GetModels<Schema>;

    /**
     * The mutation action that is being performed.
     */
    action: 'create' | 'update' | 'delete';

    /**
     * The mutation data. Only available for create and update actions.
     */
    queryNode: OperationNode;
};

export type OnQueryArgs<Schema extends SchemaDef> = QueryContext<Schema> & {
    proceed: ProceedQueryFunction<Schema>;
};

export type PluginBeforeEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    entities?: Record<string, unknown>[];
};

export type PluginAfterEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    beforeMutationEntities?: Record<string, unknown>[];
    afterMutationEntities?: Record<string, unknown>[];
};

export type ProceedQueryFunction<Schema extends SchemaDef> = (
    queryArgs: unknown,
    tx?: ClientContract<Schema>,
) => Promise<unknown>;

export type OnKyselyQueryTransactionCallback = (proceed: ProceedKyselyQueryFunction) => Promise<QueryResult<any>>;

export type OnKyselyQueryTransaction = (callback: OnKyselyQueryTransactionCallback) => Promise<QueryResult<any>>;

export type OnKyselyQueryArgs<Schema extends SchemaDef> = {
    kysely: ToKysely<Schema>;
    schema: SchemaDef;
    client: ClientContract<Schema>;
    query: RootOperationNode;
    proceed: ProceedKyselyQueryFunction;
};

export type ProceedKyselyQueryFunction = (query: RootOperationNode) => Promise<QueryResult<any>>;

/**
 * ZenStack runtime plugin.
 */
export interface RuntimePlugin<Schema extends SchemaDef = SchemaDef> {
    /**
     * Plugin ID.
     */
    id: string;

    /**
     * Plugin display name.
     */
    name?: string;

    /**
     * Plugin description.
     */
    description?: string;

    /**
     * Intercepts an ORM query.
     */
    onQuery?: OnQueryHooks<Schema>;

    /**
     * Intercepts a Kysely query.
     */
    onKyselyQuery?: (args: OnKyselyQueryArgs<Schema>) => Promise<QueryResult<UnknownRow>>;

    /**
     * This callback determines whether a mutation should be intercepted, and if so,
     * what data should be loaded before and after the mutation.
     */
    mutationInterceptionFilter?: (args: MutationHooksArgs<Schema>) => MaybePromise<MutationInterceptionFilterResult>;

    /**
     * Called before an entity is mutated.
     * @param args.entity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeEntityMutation?: (args: PluginBeforeEntityMutationArgs<Schema>) => MaybePromise<void>;

    /**
     * Called after an entity is mutated.
     * @param args.beforeMutationEntity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     * @param args.afterMutationEntity Only available if `loadAfterMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    afterEntityMutation?: (args: PluginAfterEntityMutationArgs<Schema>) => MaybePromise<void>;
}

type OnQueryHooks<Schema extends SchemaDef = SchemaDef> = {
    [Model in GetModels<Schema> as Uncapitalize<Model>]?: OnQueryOperationHooks<Schema, Model>;
} & {
    $allModels?: OnQueryOperationHooks<Schema, GetModels<Schema>>;
};

type OnQueryOperationHooks<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Operation in keyof ModelOperations<Schema, Model>]?: (
        ctx: OnQueryHookContext<Schema, Model, Operation>,
    ) => Promise<Awaited<ReturnType<ModelOperations<Schema, Model>[Operation]>>>;
} & {
    $allOperations?: (ctx: {
        model: Model;
        operation: CrudOperation;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
        client: ClientContract<Schema>;
    }) => MaybePromise<unknown>;
};

type OnQueryHookContext<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Operation extends keyof ModelOperations<Schema, Model>,
> = {
    /**
     * The model that is being queried.
     */
    model: Model;

    /**
     * The operation that is being performed.
     */
    operation: Operation;

    /**
     * The query arguments.
     */
    args: Parameters<ModelOperations<Schema, Model>[Operation]>[0];

    /**
     * The query function to proceed with the original query.
     * It takes the same arguments as the operation method.
     *
     * @param args The query arguments.
     */
    query: (
        args: Parameters<ModelOperations<Schema, Model>[Operation]>[0],
    ) => ReturnType<ModelOperations<Schema, Model>[Operation]>;

    /**
     * The ZenStack client that is performing the operation.
     */
    client: ClientContract<Schema>;
};

/**
 * Defines a ZenStack runtime plugin.
 */
export function definePlugin<Schema extends SchemaDef>(plugin: RuntimePlugin<Schema>) {
    return plugin;
}

export { type CrudOperation } from './crud/operations/base';
