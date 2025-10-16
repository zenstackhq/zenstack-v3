import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1530', () => {
    it('verifies issue 1530', async () => {
        const db = await createTestClient(
            `
    model Category {
        id       Int        @id @default(autoincrement())
        name     String     @unique

        parentId Int?
        parent   Category?  @relation("ParentChildren", fields: [parentId], references: [id])
        children Category[] @relation("ParentChildren")
        @@allow('all', true)
    }
                `,
            { usePrismaPush: true },
        );

        await db.$unuseAll().category.create({
            data: { id: 1, name: 'C1' },
        });

        await db.category.update({
            where: { id: 1 },
            data: { parent: { connect: { id: 1 } } },
        });

        const r = await db.category.update({
            where: { id: 1 },
            data: { parent: { disconnect: true } },
        });
        expect(r.parent).toBeUndefined();
    });
});
