import type { Model } from '@zenstackhq/language/ast';
import type {
    KyselyPlugin,
    OperationNode,
    QueryResult,
    RootOperationNode,
    UnknownRow,
} from 'kysely';
import type { ClientContract } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { MaybePromise } from '../utils/type-utils';
import type { QueryContext } from './query-executor';

/**
 * The result of the hooks interception filter.
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
     * The top-level query context.
     */
    context: PluginContext<Schema>;
};

export type PluginContext<Schema extends SchemaDef> = QueryContext<Schema>;

export type OnQueryArgs<Schema extends SchemaDef> = PluginContext<Schema> & {
    proceed: ProceedQueryFunction<Schema>;
};

export type PluginTransformKyselyQueryArgs<Schema extends SchemaDef> = {
    client: ClientContract<Schema>;
    node: RootOperationNode;
};

export type PluginTransformKyselyResultArgs<Schema extends SchemaDef> = {
    client: ClientContract<Schema>;
    result: QueryResult<UnknownRow>;
};

export type PluginBeforeEntityMutationArgs<Schema extends SchemaDef> =
    MutationHooksArgs<Schema> & {
        entities?: Record<string, unknown>[];
    };

export type PluginAfterEntityMutationArgs<Schema extends SchemaDef> =
    MutationHooksArgs<Schema> & {
        beforeMutationEntities?: Record<string, unknown>[];
        afterMutationEntities?: Record<string, unknown>[];
    };

export type ProceedQueryFunction<Schema extends SchemaDef> = (
    queryArgs?: unknown,
    tx?: ClientContract<Schema>
) => Promise<unknown>;

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
    onQuery?: (args: OnQueryArgs<Schema>) => Promise<unknown>;

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
     * This callback determines whether a mutation should be intercepted, and if so,
     * what data should be loaded before and after the mutation.
     */
    mutationInterceptionFilter?: (
        args: MutationHooksArgs<Schema>
    ) => MaybePromise<MutationInterceptionFilterResult>;

    /**
     * Called before an entity is mutated.
     * @param args.entity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     */
    beforeEntityMutation?: (
        args: PluginBeforeEntityMutationArgs<Schema>
    ) => MaybePromise<void>;

    /**
     * Called after an entity is mutated.
     * @param args.beforeMutationEntity Only available if `loadBeforeMutationEntity` is set to true in the
     * return value of {@link RuntimePlugin.mutationInterceptionFilter}.
     * @param args.afterMutationEntity Only available if `loadAfterMutationEntity` is set to true in the
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
