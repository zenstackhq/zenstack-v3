import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1585', () => {
    it('verifies issue 1585', async () => {
        const db = await createTestClient(
            `
                model Asset {
                    id Int @id @default(autoincrement())
                    type String
                    views Int

                    @@allow('all', true)
                    @@delegate(type)
                }
            
                model Post extends Asset {
                    title String
                }
                `,
        );

        await db.post.create({ data: { title: 'Post1', views: 0 } });
        await db.post.create({ data: { title: 'Post2', views: 1 } });
        await expect(
            db.post.count({
                where: { views: { gt: 0 } },
            }),
        ).resolves.toBe(1);
    });
});
