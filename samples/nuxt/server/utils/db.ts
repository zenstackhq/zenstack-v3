import { ZenStackClient } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import SQLite from 'better-sqlite3';
import { schema } from '../../zenstack/schema';

export const db = new ZenStackClient(schema, {
    dialect: new SqliteDialect({
        database: new SQLite('./zenstack/dev.db'),
    }),
    procedures: {
        signUp: ({ client, args }) =>
            client.user.create({
                data: { ...args },
            }),
        listPublicPosts: ({ client }) =>
            client.post.findMany({
                where: {
                    published: true,
                },
                orderBy: {
                    updatedAt: 'desc',
                },
            }),
    },
});
