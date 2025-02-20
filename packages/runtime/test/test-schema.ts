import type { OperandExpression, SqlBool } from 'kysely';
import { sql } from 'kysely';
import type { Client } from '../src/client';
import { Expression } from '../src/schema/expression';
import type { DataSourceProvider, SchemaDef } from '../src/schema/schema';

const schema = {
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
                profile: {
                    type: 'Profile',
                    relation: {
                        opposite: 'user',
                    },
                    optional: true,
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
        Profile: {
            dbTable: 'Profile',
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    generator: 'cuid',
                },
                bio: { type: 'String' },
                user: {
                    type: 'User',
                    relation: {
                        fields: ['userId'],
                        references: ['id'],
                        opposite: 'profile',
                    },
                },
                userId: {
                    type: 'String',
                    foreignKeyFor: ['user'],
                    unique: true,
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'String' },
                userId: { type: 'String' },
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
    authModel: 'User',
} as const satisfies SchemaDef;

export function getSchema<Provider extends DataSourceProvider>(
    provider: Provider
) {
    return { ...schema, provider };
}

export async function pushSchema(db: Client<typeof schema>) {
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

    await db.$qb.schema
        .createTable('Profile')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('bio', 'varchar', (col) => col.notNull())
        .addColumn('userId', 'varchar', (col) =>
            col.references('User.id').notNull()
        )
        .execute();
}
