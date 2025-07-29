import type { ClientContract } from '../../src';
import { PolicyPlugin } from '../../src/plugins/policy';
import type { SchemaDef } from '../../src/schema';
import { createTestClient, type CreateTestClientOptions } from '../utils';

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
