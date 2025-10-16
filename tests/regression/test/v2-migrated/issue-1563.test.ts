import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1563', () => {
    it('verifies issue 1563', async () => {
        const db = await createTestClient(
            `
    model ModelA {
        id String @id @default(cuid())
        ref ModelB[]
    }

    model ModelB {
        id String @id @default(cuid())
        ref ModelA? @relation(fields: [refId], references: [id])
        refId String?

        @@validate(refId != null, "refId must be set")
    }
            `,
        );

        const a = await db.modelA.create({ data: {} });
        const b = await db.modelB.create({ data: { refId: a.id } });

        await expect(db.modelB.update({ where: { id: b.id }, data: { refId: a.id } })).toResolveTruthy();
    });
});
