import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2025', () => {
    it('verifies issue 2025', async () => {
        const db = await createTestClient(
            `
        model User {
            id String @id @default(cuid())
            email String @unique @email
            termsAndConditions Int?
            @@allow('all', true)
        }
                `,
        );

        await expect(
            db.user.create({
                data: {
                    email: 'xyz',
                },
            }),
        ).toBeRejectedByValidation();

        const user = await db.$setInputValidation(false).user.create({
            data: {
                email: 'xyz',
            },
        });

        await expect(
            db.user.update({
                where: { id: user.id },
                data: {
                    termsAndConditions: 1,
                },
            }),
        ).toResolveTruthy();
    });
});
