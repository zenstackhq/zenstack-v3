import { createId } from '@paralleldrive/cuid2';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { toKysely } from '../src/client/query-builder';
import { pushSchema, Schema } from './test-schema';

describe('Client API tests', () => {
    type KyselyTable = toKysely<typeof Schema>;

    it('works with queries', async () => {
        const dialect = new SqliteDialect({ database: new SQLite(':memory:') });
        const db = new Kysely<KyselyTable>({ dialect });
        await pushSchema(db);

        const uid = createId();
        await db
            .insertInto('user')
            .values({
                id: uid,
                email: 'a@b.com',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        const u1 = await db
            .selectFrom('user')
            .select('email')
            .where('id', '=', uid)
            .executeTakeFirst();
        expect(u1).toBeTruthy();

        await db
            .insertInto('post')
            .values({
                id: createId(),
                authorId: uid,
                title: 'Post1',
                content: 'My post',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        const u2 = await db
            .selectFrom('user')
            .innerJoin('post', 'user.id', 'post.authorId')
            .select(['user.email', 'post.title'])
            .executeTakeFirstOrThrow();
        console.log(u2);
        expect(u2).toMatchObject({ title: 'Post1', email: 'a@b.com' });

        const u3 = await db
            .selectFrom('user')
            .selectAll()
            .executeTakeFirstOrThrow();
        console.log(u3);
        expect(u3).toMatchObject({ email: 'a@b.com', role: 'USER' });
    });
});
