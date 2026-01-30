import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 598', () => {
    it('access policy can reference mixin fields from imported files', async () => {
        const db = await createPolicyTestClient(
            `
import './mixins'

datasource db {
    provider = 'postgresql'
    url = '$DB_URL'
}

model User {
    id Int @id @default(autoincrement())
    email String @unique
    documents Document[]

    @@allow('all', true)
}

model Document with AuditMixin {
    id String @id @default(cuid())
    title String
    ownerId Int
    owner User @relation(fields: [ownerId], references: [id])

    @@allow('create,read', auth() != null)
    @@allow('update', auth().id == createdById)  // createdById from mixin
}
            `,
            {
                extraZModelFiles: {
                    mixins: `
type AuditMixin {
    createdById Int
    createdAt DateTime @default(now())
}
                    `,
                },
            },
        );

        // Test that the policy rule using mixin field works correctly
        const userDb = db.$setAuth({ id: 1 });
        const otherUserDb = db.$setAuth({ id: 2 });

        // Create users first
        await db.user.create({ data: { id: 1, email: 'user1@test.com' } });
        await db.user.create({ data: { id: 2, email: 'user2@test.com' } });

        // Create document as user 1
        await userDb.document.create({
            data: {
                id: 'doc-1',
                title: 'Test Document',
                ownerId: 1,
                createdById: 1, // From mixin
            },
        });

        // User 1 should be able to update (matches createdById)
        await expect(
            userDb.document.update({
                where: { id: 'doc-1' },
                data: { title: 'Updated' },
            }),
        ).toResolveTruthy();

        // User 2 should NOT be able to update (different createdById)
        await expect(
            otherUserDb.document.update({
                where: { id: 'doc-1' },
                data: { title: 'Hacked' },
            }),
        ).toBeRejectedNotFound();
    });
});
