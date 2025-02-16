import type { DBClient } from '@zenstackhq/runtime/client';
import { Expression, type SchemaDef } from '@zenstackhq/runtime/schema';
import { sql, type OperandExpression, type SqlBool } from 'kysely';

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

            policies: [
                // @@allow('all', auth() == this)
                {
                    kind: 'allow',
                    operations: ['all'],
                    expression: Expression.binary(
                        Expression.call('auth'),
                        '==',
                        Expression._this()
                    ),
                },
                // @@allow('read', auth() != null)
                {
                    kind: 'allow',
                    operations: ['read'],
                    expression: Expression.binary(
                        Expression.call('auth'),
                        '!=',
                        Expression._null()
                    ),
                },
                // @@allow('read', emailFromDomain('zenstack.dev'))
                {
                    kind: 'allow',
                    operations: ['read'],
                    expression: Expression.call('emailFromDomain', [
                        Expression.literal('zenstack.dev'),
                    ]),
                },
            ],

            externalRules: {
                emailFromDomain(_domain: string): OperandExpression<SqlBool> {
                    throw new Error('Not implemented');
                },
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

            policies: [
                // @@deny('all', auth() == null)
                {
                    kind: 'deny',
                    operations: ['all'],
                    expression: Expression.binary(
                        Expression.call('auth'),
                        '==',
                        Expression._null()
                    ),
                },
                // @@allow('all', auth() == author)
                {
                    kind: 'allow',
                    operations: ['all'],
                    expression: Expression.binary(
                        Expression.call('auth'),
                        '==',
                        Expression.ref('Post', 'author')
                    ),
                },
                {
                    kind: 'allow',
                    operations: ['read'],
                    expression: Expression.ref('Post', 'published'),
                },
            ],
        },
    },
    enums: {
        Role: {
            ADMIN: 'ADMIN',
            USER: 'USER',
        },
    },
    authModel: 'User',
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
