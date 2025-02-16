import {
    type KyselyPlugin,
    type PluginTransformQueryArgs,
    type PluginTransformResultArgs,
    type QueryResult,
    type RootOperationNode,
    type UnknownRow,
} from 'kysely';
import type { SchemaDef } from '../../../schema';
import type { QueryDialect } from '../../operations/dialect';
import type { PolicySettings } from '../../options';
import { PolicyTransformer } from './policy-transformer';

export class PolicyPlugin<Schema extends SchemaDef> implements KyselyPlugin {
    private readonly transformer: PolicyTransformer<Schema>;
    constructor(
        schema: Schema,
        queryDialect: QueryDialect,
        policySettings: PolicySettings<Schema>
    ) {
        this.transformer = new PolicyTransformer(
            schema,
            queryDialect,
            policySettings
        );
    }

    transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
        return this.transformer.transformNode(node);
    }

    async transformResult(
        args: PluginTransformResultArgs
    ): Promise<QueryResult<UnknownRow>> {
        return args.result;
    }
}
