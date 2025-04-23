import {
    type OnKyselyQueryArgs,
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

    onKyselyQuery({ proceed, query, client }: OnKyselyQueryArgs<Schema>) {
        const transformer = new PolicyTransformer<Schema>(client, this.options);
        const transformedQuery = transformer.transformNode(query);
        return proceed(transformedQuery);
    }

    setAuth(auth: Auth<Schema>) {
        return new PolicyPlugin<Schema>({
            ...this.options,
            auth,
        });
    }
}
