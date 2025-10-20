import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Client $connect and $disconnect tests', () => {
    it('works with connect and disconnect', async () => {
        const db = await createTestClient(
            `
        model User {
            id String @id @default(cuid())
            email String @unique
        }
        `,
        );

        // connect to the database
        await db.$connect();

        // perform a simple operation
        await db.user.create({
            data: {
                email: 'u1@test.com',
            },
        });

        await db.$disconnect();

        await expect(db.user.findFirst()).rejects.toThrow();
    });
});
