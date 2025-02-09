import { createId } from '@paralleldrive/cuid2';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { toKysely } from '../src/client/query-builder';
import { getSchema, pushSchema } from './test-schema';

describe('Client API tests', () => {
    const schema = getSchema('sqlite');
    type KyselyTable = toKysely<typeof schema>;

    it('works with queries', async () => {
        const dialect = new SqliteDialect({ database: new SQLite(':memory:') });
        const db = new Kysely<KyselyTable>({ dialect });
        await pushSchema(db);

        const uid = createId();
        await db
            .insertInto('User')
            .values({
                id: uid,
                email: 'a@b.com',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        const u1 = await db
            .selectFrom('User')
            .select('email')
            .where('id', '=', uid)
            .executeTakeFirst();
        expect(u1).toBeTruthy();

        await db
            .insertInto('Post')
            .values({
                id: createId(),
                authorId: uid,
                title: 'Post1',
                content: 'My post',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        const u2 = await db
            .selectFrom('User')
            .innerJoin('Post', 'User.id', 'Post.authorId')
            .select(['User.email', 'Post.title'])
            .executeTakeFirstOrThrow();
        console.log(u2);
        expect(u2).toMatchObject({ title: 'Post1', email: 'a@b.com' });

        const u3 = await db
            .selectFrom('User')
            .selectAll()
            .executeTakeFirstOrThrow();
        console.log(u3);
        expect(u3).toMatchObject({ email: 'a@b.com', role: 'USER' });
    });
});
