import type { Model } from '@zenstackhq/language/ast';
import type {
    KyselyPlugin,
    QueryResult,
    RootOperationNode,
    UnknownRow,
} from 'kysely';
import type { ClientContract } from '.';
import type { SchemaDef } from '../schema';
import type { MaybePromise } from '../utils/type-utils';
import type { QueryContext } from './query-executor';

/**
 * The result of the lifecycle interception filter.
 */
export type MutationInterceptionFilterResult = {
    /**
     * Whether to intercept the mutation or not.
     */
    intercept: boolean;

    /**
     * Whether to use a transaction for the mutation.
     */
    useTransactionForMutation?: boolean;

    /**
     * Whether entities should be loaded before the mutation.
     */
    loadBeforeMutationEntity?: boolean;

    /**
     * Whether entities should be loaded after the mutation.
     */
    loadAfterMutationEntity?: boolean;
};

type MutationLifecycleEventArgs<Schema extends SchemaDef> = {
    /**
     * The mutation action that is being performed.
     */
    action: 'create' | 'update' | 'delete';

    /**
     * The mutation data. Only available for create and update actions.
     */
    data: unknown | undefined;
} & PluginContext<Schema>;

export type PluginContext<Schema extends SchemaDef> = QueryContext<Schema>;

export type PluginTransformKyselyQueryArgs<Schema extends SchemaDef> = {
    client: ClientContract<Schema>;
    node: RootOperationNode;
};

export type PluginTransformKyselyResultArgs<Schema extends SchemaDef> = {
    client: ClientContract<Schema>;
    result: QueryResult<UnknownRow>;
};

export type PluginBeforeEntityMutationArgs<Schema extends SchemaDef> =
    MutationLifecycleEventArgs<Schema> & {
        entity: unknown | undefined;
    };

export type PluginAfterEntityMutationArgs<Schema extends SchemaDef> =
    MutationLifecycleEventArgs<Schema> & {
        beforeMutationEntity: unknown | undefined;
        afterMutationEntity: unknown | undefined;
    };

export interface PluginInfo {
    /**
     * Plugin ID.
     */
    id: string;

    /**
     * Plugin name.
     */
    name?: string;

    /**
     * Plugin description.
     */
    description?: string;
}

/**
 * ZenStack runtime plugin. This base class inherits from {@link KyselyPlugin} to support low-level
 * query and result transformation.
 */
export interface RuntimePlugin<Schema extends SchemaDef = SchemaDef>
    extends PluginInfo {
    /**
     * Kysely query transformation. See {@link KyselyPlugin.transformQuery}.
     */
    transformKyselyQuery?: (
        args: PluginTransformKyselyQueryArgs<Schema>
    ) => RootOperationNode;

    /**
     * Kysely query result transformation. See {@link KyselyPlugin.transformResult}.
     */
    transformKyselyResult?: (
        args: PluginTransformKyselyResultArgs<Schema>
    ) => Promise<QueryResult<UnknownRow>>;

    /**
     * Called before an ORM query is executed.
     */
    beforeQuery?: (args: PluginContext<Schema>) => MaybePromise<void>;

    /**
     * Called after an ORM is executed.
     */
    afterQuery?: (
        args: {
            result: unknown | undefined;
            error: unknown | undefined;
        } & PluginContext<Schema>
    ) => MaybePromise<void>;

    /**
     * This callback determines whether a mutation should be intercepted, and if so,
     * what data should be loaded before and after the mutation.
     */
    mutationInterceptionFilter?: (
        args: MutationLifecycleEventArgs<Schema>
    ) => MaybePromise<MutationInterceptionFilterResult>;

    /**
     * Called before an entity is mutated.
     * @param entity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeEntityMutation?: (
        args: PluginBeforeEntityMutationArgs<Schema>
    ) => MaybePromise<void>;

    /**
     * Called after an entity is mutated.
     * @param beforeMutationEntity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     * @param afterMutationEntity Only available if `loadAfterMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    afterEntityMutation?: (
        args: PluginAfterEntityMutationArgs<Schema>
    ) => MaybePromise<void>;
}

// TODO: move to SDK
export type CliGeneratorContext = {
    model: Model;
    outputPath: string;
    tsSchemaFile: string;
};

// TODO: move to SDK
export type CliGenerator = (context: CliGeneratorContext) => MaybePromise<void>;

export { type CrudOperation } from './crud/operations/base';
