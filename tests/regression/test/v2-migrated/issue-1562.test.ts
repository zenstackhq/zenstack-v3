import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1562', () => {
    it('verifies issue 1562', async () => {
        const db = await createTestClient(
            `
    type Base {
        id        String   @id @default(uuid())
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt()

        // require login
        @@allow('all', true)
    }

    model User with Base {
        name String @unique @regex('^[a-zA-Z0-9_]{3,30}$')

        @@allow('read', true)
    }
                `,
        );

        await expect(db.user.create({ data: { name: '1 2 3 4' } })).toBeRejectedByValidation();
    });
});
