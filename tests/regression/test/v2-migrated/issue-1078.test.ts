import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 1078', () => {
    it('regression1', async () => {
        const db = await createPolicyTestClient(
            `
            model Counter {
                id String @id
              
                name String
                value Int
              
                @@validate(value >= 0)
                @@allow('all', true)
            }
            `,
        );

        await expect(
            db.counter.create({
                data: { id: '1', name: 'It should create', value: 1 },
            }),
        ).toResolveTruthy();

        //! This query fails validation
        await expect(
            db.counter.update({
                where: { id: '1' },
                data: { name: 'It should update' },
            }),
        ).toResolveTruthy();
    });

    // TODO: field-level policy support
    it.skip('regression2', async () => {
        const db = await createPolicyTestClient(
            `
            model Post {
                id Int @id() @default(autoincrement())
                title String @allow('read', true, true)
                content String
            }
            `,
        );

        const post = await db.$unuseAll().post.create({ data: { title: 'Post1', content: 'Content' } });
        await expect(db.post.findUnique({ where: { id: post.id } })).toResolveNull();
        await expect(db.post.findUnique({ where: { id: post.id }, select: { title: true } })).resolves.toEqual({
            title: 'Post1',
        });
    });
});
