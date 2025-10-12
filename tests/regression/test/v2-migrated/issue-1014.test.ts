import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

// TODO: field-level policy support
describe.skip('Regression for issue 1014', () => {
    it('update', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id() @default(autoincrement())
                name String
                posts Post[]
            }

            model Post {
                id Int @id() @default(autoincrement())
                title String
                content String?
                author User? @relation(fields: [authorId], references: [id])
                authorId Int? @allow('update', true, true)
            
                @@allow('read', true)
            }
            `,
        );

        const user = await db.$unuseAll().user.create({ data: { name: 'User1' } });
        const post = await db.$unuseAll().post.create({ data: { title: 'Post1' } });
        await expect(db.post.update({ where: { id: post.id }, data: { authorId: user.id } })).toResolveTruthy();
    });

    it('read', async () => {
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
