import type { OperationNode, QueryResult, RootOperationNode, UnknownRow } from 'kysely';
import type { ClientContract } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { MaybePromise } from '../utils/type-utils';
import type { AllCrudOperation } from './crud/operations/base';
import type { ZModelFunction } from './options';

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
     * Custom function implementations.
     */
    functions?: Record<string, ZModelFunction<Schema>>;

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

export { type CoreCrudOperation as CrudOperation } from './crud/operations/base';

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
     * Called before entities are mutated.
     */
    beforeEntityMutation?: BeforeEntityMutationCallback<Schema>;

    /**
     * Called after entities are mutated.
     */
    afterEntityMutation?: AfterEntityMutationCallback<Schema>;

    /**
     * Whether to run after-mutation hooks within the transaction that performs the mutation.
     *
     * If set to `true`, if the mutation already runs inside a transaction, the callbacks are
     * executed immediately after the mutation within the transaction boundary. If the mutation
     * is not running inside a transaction, a new transaction is created to run both the mutation
     * and the callbacks.
     *
     * If set to `false`, the callbacks are executed after the mutation transaction is committed.
     *
     * Defaults to `false`.
     */
    runAfterMutationWithinTransaction?: boolean;
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

    /**
     * A query ID that uniquely identifies the mutation operation. You can use it to correlate
     * data between the before and after mutation hooks.
     */
    queryId: string;
};

export type BeforeEntityMutationCallback<Schema extends SchemaDef> = (
    args: PluginBeforeEntityMutationArgs<Schema>,
) => MaybePromise<void>;

export type AfterEntityMutationCallback<Schema extends SchemaDef> = (
    args: PluginAfterEntityMutationArgs<Schema>,
) => MaybePromise<void>;

export type PluginBeforeEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    /**
     * Loads the entities that are about to be mutated. The db operation that loads the entities is executed
     * within the same transaction context as the mutation.
     */
    loadBeforeMutationEntities(): Promise<Record<string, unknown>[] | undefined>;

    /**
     * The ZenStack client you can use to perform additional operations. The database operations initiated
     * from this client are executed within the same transaction as the mutation if the mutation is running
     * inside a transaction.
     *
     * Mutations initiated from this client will NOT trigger entity mutation hooks to avoid infinite loops.
     */
    client: ClientContract<Schema>;
};

export type PluginAfterEntityMutationArgs<Schema extends SchemaDef> = MutationHooksArgs<Schema> & {
    /**
     * Loads the entities that have been mutated.
     */
    loadAfterMutationEntities(): Promise<Record<string, unknown>[] | undefined>;

    /**
     * The ZenStack client you can use to perform additional operations.
     * See {@link EntityMutationHooksDef.runAfterMutationWithinTransaction} for detailed transaction behavior.
     *
     * Mutations initiated from this client will NOT trigger entity mutation hooks to avoid infinite loops.
     */
    client: ClientContract<Schema>;
};

// #endregion

// #region OnKyselyQuery hooks

export type OnKyselyQueryArgs<Schema extends SchemaDef> = {
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
