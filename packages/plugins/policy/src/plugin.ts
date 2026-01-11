import { type OnKyselyQueryArgs, type RuntimePlugin } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { check } from './functions';
import { PolicyHandler } from './policy-handler';

export class PolicyPlugin<Schema extends SchemaDef> implements RuntimePlugin<'policy', Schema> {
    get id() {
        return 'policy' as const;
    }

    get name() {
        return 'Access Policy';
    }

    get description() {
        return 'Enforces access policies defined in the schema.';
    }

    get functions() {
        return {
            check,
        };
    }

    onKyselyQuery({ query, client, proceed }: OnKyselyQueryArgs<Schema>) {
        const handler = new PolicyHandler<Schema>(client);
        return handler.handle(query, proceed);
    }
}
