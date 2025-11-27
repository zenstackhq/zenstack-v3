import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';
import { schema } from '../schemas/auth-type/schema';

describe('Custom auth typing tests', () => {
    it('works with custom auth typing', async () => {
        const db = await createTestClient(schema);
        db.$setAuth({
            id: 1,
            role: 'ADMIN',
            permissions: [
                {
                    actionCode: 'MANAGE',
                },
            ],
        });
    });
});
