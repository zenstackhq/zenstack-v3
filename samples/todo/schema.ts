import type { DBClient, SchemaDef } from '@zenstackhq/runtime';
import { sql } from 'kysely';

export const Schema = {
    provider: 'sqlite',
    models: {
        User: {
            dbTable: 'User',
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    generator: 'cuid',
                },
                email: {
                    type: 'String',
                    unique: true,
                },
                name: {
                    type: 'String',
                    optional: true,
                },
                createdAt: {
                    type: 'DateTime',
                    default: { call: 'now()' },
                },
                updatedAt: {
                    type: 'DateTime',
                    updatedAt: true,
                },
                role: {
                    type: 'Role',
                    default: 'USER',
                },
                posts: {
                    type: 'Post',
                    array: true,
                    relation: {
                        opposite: 'author',
                    },
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'String' },
                email: { type: 'String' },
            },
        },
        Post: {
            dbTable: 'Post',
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    generator: 'cuid',
                },
                createdAt: {
                    type: 'DateTime',
                    default: { call: 'now()' },
                },
                updatedAt: {
                    type: 'DateTime',
                    updatedAt: true,
                },
                title: {
                    type: 'String',
                },
                content: {
                    type: 'String',
                    optional: true,
                },
                published: {
                    type: 'Boolean',
                    default: false,
                },
                author: {
                    type: 'User',
                    relation: {
                        fields: ['authorId'],
                        references: ['id'],
                        opposite: 'posts',
                    },
                },
                authorId: {
                    type: 'String',
                    foreignKeyFor: ['author'],
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'String' },
            },
        },
        Foo: {
            dbTable: 'Foo',
            fields: {
                id1: { type: 'Int' },
                id2: { type: 'Int' },
            },
            idFields: ['id1', 'id2'],
            uniqueFields: {
                id1_id2: { id1: { type: 'Int' }, id2: { type: 'Int' } },
            },
        },
    },
    enums: {
        Role: {
            ADMIN: 'ADMIN',
            USER: 'USER',
        },
    },
} as const satisfies SchemaDef;

export async function pushSchema(db: DBClient<typeof Schema>) {
    await db.$qb.schema
        .createTable('User')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('createdAt', 'timestamp', (col) =>
            col.defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updatedAt', 'timestamp', (col) => col.notNull())
        .addColumn('email', 'varchar', (col) => col.unique().notNull())
        .addColumn('name', 'varchar')
        .addColumn('role', 'varchar', (col) => col.defaultTo('USER'))
        .execute();

    await db.$qb.schema
        .createTable('Post')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('createdAt', 'timestamp', (col) =>
            col.defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updatedAt', 'timestamp', (col) => col.notNull())
        .addColumn('title', 'varchar', (col) => col.notNull())
        .addColumn('content', 'varchar')
        .addColumn('published', 'boolean', (col) => col.defaultTo(false))
        .addColumn('authorId', 'varchar', (col) =>
            col.references('User.id').notNull()
        )
        .execute();
}
