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
import type { PolicyFeatureSettings } from '../../types';
import { PolicyTransformer } from './policy-transformer';

export class PolicyPlugin implements KyselyPlugin {
    private readonly transformer: PolicyTransformer;
    constructor(
        schema: SchemaDef,
        queryDialect: QueryDialect,
        policySettings: PolicyFeatureSettings
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
