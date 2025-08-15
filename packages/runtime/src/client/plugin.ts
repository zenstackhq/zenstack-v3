import type { OperationNode, QueryResult, RootOperationNode, UnknownRow } from 'kysely';
import type { ClientContract, ToKysely } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { MaybePromise } from '../utils/type-utils';
import type { AllCrudOperation } from './crud/operations/base';

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
    onQuery?: OnQueryCallback<Schema>;

    /**
     * Intercepts an entity mutation.
     */
    onEntityMutation?: EntityMutationHooksDef<Schema>;

    /**
     * Intercepts a Kysely query.
     */
    onKyselyQuery?: OnKyselyQueryCallback<Schema>;
}

/**
 * Defines a ZenStack runtime plugin.
 */
export function definePlugin<Schema extends SchemaDef>(plugin: RuntimePlugin<Schema>) {
    return plugin;
}

export { type CrudOperation } from './crud/operations/base';

// #region OnQuery hooks

type OnQueryCallback<Schema extends SchemaDef> = (ctx: OnQueryHookContext<Schema>) => Promise<unknown>;

type OnQueryHookContext<Schema extends SchemaDef> = {
    /**
     * The model that is being queried.
     */
    model: GetModels<Schema>;

    /**
     * The operation that is being performed.
     */
    operation: AllCrudOperation;

    /**
     * The query arguments.
     */
    args: unknown;

    /**
     * The function to proceed with the original query.
     * It takes the same arguments as the operation method.
     *
     * @param args The query arguments.
     */
    proceed: (args: unknown) => Promise<unknown>;

    /**
     * The ZenStack client that is performing the operation.
     */
    client: ClientContract<Schema>;
};

// #endregion

// #region OnEntityMutation hooks

export type EntityMutationHooksDef<Schema extends SchemaDef> = {
    /**
     * This callback determines whether a mutation should be intercepted, and if so,
     * what data should be loaded before and after the mutation.
     */
    mutationInterceptionFilter?: MutationInterceptionFilter<Schema>;

    /**
     * Called before an entity is mutated.
     * @param args.entity Only available if `loadBeforeMutationEntities` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeEntityMutation?: BeforeEntityMutationCallback<Schema>;

    /**
     * Called after an entity is mutated.
     * @param args.beforeMutationEntity Only available if `loadBeforeMutationEntities` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     * @param args.afterMutationEntity Only available if `loadAfterMutationEntities` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    afterEntityMutation?: AfterEntityMutationCallback<Schema>;
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

export type MutationInterceptionFilter<Schema extends SchemaDef> = (
    args: MutationHooksArgs<Schema>,
) => MaybePromise<MutationInterceptionFilterResult>;

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
    loadBeforeMutationEntities?: boolean;

    /**
     * Whether entities should be loaded after the mutation.
     */
    loadAfterMutationEntities?: boolean;
};

export type BeforeEntityMutationCallback<Schema extends SchemaDef> = (
    args: PluginBeforeEntityMutationArgs<Schema>,
) => MaybePromise<void>;

export type AfterEntityMutationCallback<Schema extends SchemaDef> = (
    args: PluginAfterEntityMutationArgs<Schema>,
) => MaybePromise<void>;

export type PluginBeforeEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    /**
     * Entities that are about to be mutated. Only available if `loadBeforeMutationEntities` is set to
     * true in the return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    entities?: unknown[];
};

export type PluginAfterEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    /**
     * Entities that are about to be mutated. Only available if `loadBeforeMutationEntities` is set to
     * true in the return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeMutationEntities?: unknown[];

    /**
     * Entities mutated. Only available if `loadAfterMutationEntities` is set to true in the return
     * value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    afterMutationEntities?: unknown[];
};

// #endregion

// #region OnKyselyQuery hooks

export type OnKyselyQueryArgs<Schema extends SchemaDef> = {
    kysely: ToKysely<Schema>;
    schema: SchemaDef;
    client: ClientContract<Schema>;
    query: RootOperationNode;
    proceed: ProceedKyselyQueryFunction;
};

export type ProceedKyselyQueryFunction = (query: RootOperationNode) => Promise<QueryResult<any>>;

export type OnKyselyQueryCallback<Schema extends SchemaDef> = (
    args: OnKyselyQueryArgs<Schema>,
) => Promise<QueryResult<UnknownRow>>;

// #endregion
