import type { ClientContract } from '@zenstackhq/runtime';
import { PolicyPlugin } from '@zenstackhq/runtime/plugins/policy';
import type { SchemaDef } from '@zenstackhq/runtime/schema';
import { createTestClient, type CreateTestClientOptions } from '@zenstackhq/testtools';

export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: Schema,
    options?: CreateTestClientOptions<Schema>,
): Promise<ClientContract<Schema>>;
export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any>;
export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: Schema | string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any> {
    return createTestClient(
        schema as any,
        {
            ...options,
            plugins: [new PolicyPlugin()],
        } as any,
    );
}
