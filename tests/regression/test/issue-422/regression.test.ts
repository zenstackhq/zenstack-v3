import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';
import { schema } from './schema';

describe('Issue 422 regression tests', () => {
    it('should infer correct auth type', async () => {
        const db = await createTestClient(schema);

        // all fields optional
        db.$setAuth({ id: 'session1' });

        // relations are allowed
        db.$setAuth({ id: 'user1', user: { id: 'user1' } });

        // nested relations are allowed
        db.$setAuth({ id: 'user1', user: { id: 'user1', profile: { name: 'User1' } } });
    });
});
