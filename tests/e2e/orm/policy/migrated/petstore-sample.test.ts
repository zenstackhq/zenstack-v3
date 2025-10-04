import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';
import { schema } from '../../schemas/petstore/schema';

describe('Pet Store Policy Tests', () => {
    it('crud', async () => {
        const petData = [
            {
                id: 'luna',
                name: 'Luna',
                category: 'kitten',
            },
            {
                id: 'max',
                name: 'Max',
                category: 'doggie',
            },
            {
                id: 'cooper',
                name: 'Cooper',
                category: 'reptile',
            },
        ];

        const db = await createPolicyTestClient(schema);

        for (const pet of petData) {
            await db.$unuseAll().pet.create({ data: pet });
        }

        await db.$unuseAll().user.create({ data: { id: 'user1', email: 'user1@abc.com' } });

        const r = await db.$setAuth({ id: 'user1' }).order.create({
            include: { user: true, pets: true },
            data: {
                user: { connect: { id: 'user1' } },
                pets: { connect: [{ id: 'luna' }, { id: 'max' }] },
            },
        });

        expect(r.user.id).toBe('user1');
        expect(r.pets).toHaveLength(2);
    });
});
