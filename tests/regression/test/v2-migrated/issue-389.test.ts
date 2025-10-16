import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Regression for issue #389', () => {
    it('verifies issue 389', async () => {
        const db = await createPolicyTestClient(`
            model model {
                id String @id @default(uuid())
                value Int
                @@allow('read', true)
                @@allow('create', value > 0)
            }
            `);
        await expect(db.model.create({ data: { value: 0 } })).toBeRejectedByPolicy();
        await expect(db.model.create({ data: { value: 1 } })).toResolveTruthy();
    });
});
