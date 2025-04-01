import type { Model } from '@zenstackhq/language/ast';
import type {
    KyselyPlugin,
    QueryResult,
    RootOperationNode,
    UnknownRow,
} from 'kysely';
import type { Client } from '.';
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

type MutationLifecycleEventArgs = {
    /**
     * The mutation action that is being performed.
     */
    action: 'create' | 'update' | 'delete';

    /**
     * The mutation data. Only available for create and update actions.
     */
    data: unknown | undefined;
};

export type PluginContext<Schema extends SchemaDef> = QueryContext<Schema>;

export type PluginTransformKyselyQueryArgs<Schema extends SchemaDef> = {
    client: Client<Schema>;
    node: RootOperationNode;
};

export type PluginTransformKyselyResultArgs<Schema extends SchemaDef> = {
    client: Client<Schema>;
    result: QueryResult<UnknownRow>;
};

export type PluginTransformResultArgs<Schema extends SchemaDef> = {
    result: QueryResult<UnknownRow>;
} & PluginContext<Schema>;

export interface PluginInfo {
    /**
     * Plugin ID.
     */
    id: string;

    /**
     * Plugin name.
     */
    name: string;

    /**
     * Plugin description.
     */
    description: string;
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
     * Query result transformation. As opposed to Kysely plugin callbacks like {@link RuntimePlugin.transformResult},
     * this method is called with ORM operations (e.g., `findUnique`, `updateMany`, etc.), args, and results.
     */
    transformResult?: (
        args: PluginTransformResultArgs<Schema>
    ) => MaybePromise<unknown>;

    /**
     * Called before an ORM query is executed.
     */
    beforeQuery?: (_args: PluginContext<Schema>) => MaybePromise<void>;

    /**
     * Called after an ORM is executed.
     */
    afterQuery?: (
        _args: { result: unknown } & PluginContext<Schema>
    ) => MaybePromise<void>;

    /**
     * This callback determines whether a mutation should be intercepted, and if so,
     * what data should be loaded before and after the mutation.
     */
    mutationInterceptionFilter?: (
        _args: MutationLifecycleEventArgs & PluginContext<Schema>
    ) => MaybePromise<MutationInterceptionFilterResult>;

    /**
     * Called before an entity is mutated.
     * @param entity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeEntityMutation?: (
        _args: MutationLifecycleEventArgs & {
            entity: unknown | undefined;
        } & PluginContext<Schema>
    ) => MaybePromise<void>;

    /**
     * Called after an entity is mutated.
     * @param beforeMutationEntity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     * @param afterMutationEntity Only available if `loadAfterMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    afterEntityMutation?: (
        _args: MutationLifecycleEventArgs & {
            beforeMutationEntity: unknown | undefined;
            afterMutationEntity: unknown | undefined;
        } & PluginContext<Schema>
    ) => MaybePromise<void>;
}

export type CliGeneratorContext = {
    model: Model;
    outputPath: string;
    tsSchemaFile: string;
};

export type CliGenerator = (context: CliGeneratorContext) => MaybePromise<void>;
