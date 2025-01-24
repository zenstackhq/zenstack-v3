import SQLite from 'better-sqlite3';
import { Kysely, sql, SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { toKysely } from '../src/client/query-builder';
import { Schema } from './test-schema';
import { createId } from '@paralleldrive/cuid2';

describe('Client API tests', () => {
    type KyselyTable = toKysely<typeof Schema>;

    async function pushSchema(db: Kysely<KyselyTable>) {
        await db.schema
            .createTable('user')
            .addColumn('id', 'text', (col) => col.primaryKey())
            .addColumn('createdAt', 'datetime', (col) =>
                col.defaultTo(sql`CURRENT_TIMESTAMP`)
            )
            .addColumn('updatedAt', 'datetime', (col) => col.notNull())
            .addColumn('email', 'varchar', (col) => col.unique().notNull())
            .addColumn('name', 'varchar')
            .addColumn('role', 'varchar', (col) => col.defaultTo('USER'))
            .execute();

        await db.schema
            .createTable('post')
            .addColumn('id', 'text', (col) => col.primaryKey())
            .addColumn('createdAt', 'timestamp', (col) =>
                col.defaultTo(sql`CURRENT_TIMESTAMP`)
            )
            .addColumn('updatedAt', 'timestamp', (col) => col.notNull())
            .addColumn('title', 'varchar', (col) => col.notNull())
            .addColumn('content', 'varchar')
            .addColumn('published', 'boolean', (col) => col.defaultTo(false))
            .addColumn('authorId', 'varchar', (col) =>
                col.references('user.id').notNull()
            )
            .execute();
    }

    it('works with queries', async () => {
        const dialect = new SqliteDialect({ database: new SQLite(':memory:') });
        const db = new Kysely<KyselyTable>({ dialect });
        await pushSchema(db);

        const uid = createId();
        const u = await db
            .insertInto('user')
            .values({
                id: uid,
                email: 'a@b.com',
                updatedAt: new Date().toISOString(),
            })
            .execute();
        console.log(u);

        const u1 = await db
            .selectFrom('user')
            .select('email')
            .where('id', '=', uid)
            .executeTakeFirst();
        console.log(u1);

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
        console.log(`${u2.title} by ${u2.email}`);

        const u3 = await db
            .selectFrom('user')
            .selectAll()
            .executeTakeFirstOrThrow();
        expect(u3.role, 'USER');
    });
});
