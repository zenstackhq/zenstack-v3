import type { ClientOptions } from '../../src/client/options';
import { PolicyPlugin } from '../../src/plugins/policy';
import type { SchemaDef } from '../../src/schema';
import { createTestClient } from '../utils';

export function createPolicyTestClient(
    schema: string | SchemaDef,
    options?: ClientOptions<SchemaDef>
) {
    return createTestClient(schema as any, {
        ...options,
        plugins: [new PolicyPlugin()],
    });
}
