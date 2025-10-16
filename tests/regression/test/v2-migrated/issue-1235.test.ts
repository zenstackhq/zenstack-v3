import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 1235', () => {
    it('regression1', async () => {
        const db = await createPolicyTestClient(
            `
model Post {
    id Int @id @default(autoincrement())
    @@deny('post-update', before().id != id)
    @@allow('all', true)
}
            `,
        );

        const post = await db.post.create({ data: {} });
        await expect(db.post.update({ data: { id: post.id + 1 }, where: { id: post.id } })).rejects.toThrow(
            /updating id fields is not supported/,
        );
    });

    it('regression2', async () => {
        const db = await createPolicyTestClient(
            `
model Post {
    id Int @id @default(autoincrement())
    @@deny('post-update', before().id != this.id)
    @@allow('all', true)
}
            `,
        );

        const post = await db.post.create({ data: {} });
        await expect(db.post.update({ data: { id: post.id + 1 }, where: { id: post.id } })).rejects.toThrow(
            /updating id fields is not supported/,
        );
    });
});
