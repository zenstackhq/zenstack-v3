import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 651', () => {
    it('float array queries should work with all operators on PostgreSQL', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    email String @unique
    floatArray Float[]
}
            `,
            { provider: 'postgresql', usePrismaPush: true },
        );

        // Create test users with different float arrays
        const user1 = await db.user.create({
            data: {
                email: 'user1@example.com',
                floatArray: [1.1, 2.2, 3.3],
            },
        });

        const user2 = await db.user.create({
            data: {
                email: 'user2@example.com',
                floatArray: [1.1, 2.2, 3.3, 4.4, 5.5],
            },
        });

        const user3 = await db.user.create({
            data: {
                email: 'user3@example.com',
                floatArray: [],
            },
        });

        // Test 'equals' operator
        const equalsResult = await db.user.findMany({
            where: {
                floatArray: {
                    equals: [1.1, 2.2, 3.3],
                },
            },
        });
        expect(equalsResult).toHaveLength(1);
        expect(equalsResult[0].id).toBe(user1.id);

        // Test 'has' operator - contains single value
        const hasResult = await db.user.findMany({
            where: {
                floatArray: {
                    has: 4.4,
                },
            },
        });
        expect(hasResult).toHaveLength(1);
        expect(hasResult[0].id).toBe(user2.id);

        // Test 'hasSome' operator - contains any of the values
        const hasSomeResult = await db.user.findMany({
            where: {
                floatArray: {
                    hasSome: [3.3, 6.6, 7.7],
                },
            },
        });
        expect(hasSomeResult).toHaveLength(2);
        expect(hasSomeResult.map((u: any) => u.id).sort()).toEqual([user1.id, user2.id].sort());

        // Test 'hasEvery' operator - contains all values
        const hasEveryResult = await db.user.findMany({
            where: {
                floatArray: {
                    hasEvery: [1.1, 2.2],
                },
            },
        });
        expect(hasEveryResult).toHaveLength(2);
        expect(hasEveryResult.map((u: any) => u.id).sort()).toEqual([user1.id, user2.id].sort());

        // Test 'isEmpty' operator
        const isEmptyResult = await db.user.findMany({
            where: {
                floatArray: {
                    isEmpty: true,
                },
            },
        });
        expect(isEmptyResult).toHaveLength(1);
        expect(isEmptyResult[0].id).toBe(user3.id);

        // Test 'isEmpty: false'
        const notEmptyResult = await db.user.findMany({
            where: {
                floatArray: {
                    isEmpty: false,
                },
            },
        });
        expect(notEmptyResult).toHaveLength(2);
        expect(notEmptyResult.map((u: any) => u.id).sort()).toEqual([user1.id, user2.id].sort());
    });
});
