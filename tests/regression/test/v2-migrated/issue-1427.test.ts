import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1427', () => {
    it('verifies issue 1427', async () => {
        const db = await createTestClient(
            `
model User {
    id   String @id @default(cuid())
    name String
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id   String @id @default(cuid())
    user User   @relation(fields: [userId], references: [id])
    userId String @unique
    @@allow('all', true)
}
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                name: 'John',
                profile: {
                    create: {},
                },
            },
        });

        const found = await db.user.findFirst({
            select: {
                id: true,
                name: true,
                profile: false,
            },
        });
        expect(found.profile).toBeUndefined();
    });
});
