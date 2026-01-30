import { createId } from '@paralleldrive/cuid2';
import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';
import { getSchema } from '../schemas/basic';

describe('Client API tests', () => {
    const schema = getSchema('sqlite');

    it('works with queries', async () => {
        const client = await createTestClient(schema);

        const kysely = client.$qb;

        const uid = createId();
        await kysely
            .insertInto('User')
            .values({
                id: uid,
                email: 'a@b.com',
                updatedAt: new Date().toISOString().replace('Z', '+00:00'),
            })
            .execute();

        const u1 = await kysely.selectFrom('User').select('email').where('id', '=', uid).executeTakeFirst();
        expect(u1).toBeTruthy();

        await kysely
            .insertInto('Post')
            .values({
                id: createId(),
                authorId: uid,
                title: 'Post1',
                content: 'My post',
                updatedAt: new Date().toISOString().replace('Z', '+00:00'),
            })
            .execute();

        const u2 = await kysely
            .selectFrom('User')
            .innerJoin('Post', 'User.id', 'Post.authorId')
            .select(['User.email', 'Post.title'])
            .executeTakeFirstOrThrow();
        expect(u2).toMatchObject({ title: 'Post1', email: 'a@b.com' });

        const u3 = await kysely.selectFrom('User').selectAll().executeTakeFirstOrThrow();
        expect(u3).toMatchObject({ email: 'a@b.com', role: 'USER' });
    });
});
