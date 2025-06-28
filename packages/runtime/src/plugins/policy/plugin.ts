import { type OnKyselyQueryArgs, type RuntimePlugin } from '../../client/plugin';
import type { SchemaDef } from '../../schema';
import { PolicyHandler } from './policy-handler';

export class PolicyPlugin<Schema extends SchemaDef> implements RuntimePlugin<Schema> {
    get id() {
        return 'policy';
    }

    get name() {
        return 'Access Policy';
    }

    get description() {
        return 'Enforces access policies defined in the schema.';
    }

    onKyselyQuery({ query, client, proceed, transaction }: OnKyselyQueryArgs<Schema>) {
        const handler = new PolicyHandler<Schema>(client);
        return handler.handle(query, proceed, transaction);
    }
}
