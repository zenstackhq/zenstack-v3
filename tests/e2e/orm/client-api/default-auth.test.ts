import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';
import { schema } from '../schemas/default-auth/schema';

describe('Auth as default value tests', () => {
    it('should create without requiring the default auth field', async () => {
        const db = await createTestClient(schema);
        const user1 = await db.user.create({ data: {} });
        await expect(db.$setAuth(user1).profile.create({ data: { bio: 'My bio' } })).resolves.toMatchObject({
            userId: user1.id,
        });

        const address = await db.address.create({ data: { city: 'Seattle ' } });
        const user2 = await db.user.create({ data: {} });
        await expect(
            db.$setAuth(user2).profile.create({ data: { bio: 'My bio', address: { connect: { id: address.id } } } }),
        ).resolves.toMatchObject({
            userId: user2.id,
        });
    });
});
