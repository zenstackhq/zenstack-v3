import type { RootOperationNode } from 'kysely';
import {
    type PluginTransformKyselyQueryArgs,
    type RuntimePlugin,
} from '../../client/plugin';
import type { SchemaDef } from '../../schema';
import type { Auth, PolicyOptions } from './options';
import { PolicyTransformer } from './policy-transformer';

export class PolicyPlugin<Schema extends SchemaDef>
    implements RuntimePlugin<Schema>
{
    private readonly options: PolicyOptions<Schema>;

    constructor(options?: PolicyOptions<Schema>) {
        this.options = options ?? {};
    }

    get id() {
        return 'policy';
    }

    get name() {
        return 'Access Policy';
    }

    get description() {
        return 'Enforces access policies defined in the schema.';
    }

    transformKyselyQuery: (
        args: PluginTransformKyselyQueryArgs<Schema>
    ) => RootOperationNode = ({ node, client }) => {
        const transformer = new PolicyTransformer<Schema>(client, this.options);
        return transformer.transformNode(node);
    };

    setAuth(auth: Auth<Schema>) {
        return new PolicyPlugin<Schema>({
            ...this.options,
            auth,
        });
    }
}
