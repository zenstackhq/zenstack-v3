import { PolicyPlugin } from '../../src/plugins/policy';
import type { SchemaDef } from '../../src/schema';
import { createTestClient, type CreateTestClientOptions } from '../utils';

export function createPolicyTestClient(
    schema: string | SchemaDef,
    options?: CreateTestClientOptions<SchemaDef>
) {
    return createTestClient(
        schema as any,
        {
            ...options,
            plugins: [new PolicyPlugin()],
        } as CreateTestClientOptions<SchemaDef>
    );
}
