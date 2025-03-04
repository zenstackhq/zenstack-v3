import {
    type KyselyPlugin,
    type PluginTransformQueryArgs,
    type PluginTransformResultArgs,
    type QueryResult,
    type RootOperationNode,
    type UnknownRow,
} from 'kysely';
import type { SchemaDef } from '../../../schema';
import type { ClientOptions } from '../../options';
import { PolicyTransformer } from './policy-transformer';

export class PolicyPlugin<Schema extends SchemaDef> implements KyselyPlugin {
    private readonly transformer: PolicyTransformer<Schema>;

    constructor(schema: Schema, options: ClientOptions<Schema>) {
        this.transformer = new PolicyTransformer(schema, options);
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
