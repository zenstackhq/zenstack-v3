import type { OperandExpression, SqlBool } from 'kysely';
import { sql } from 'kysely';
import type { Client } from '../src/client';
import { Expression } from '../src/schema/expression';
import type { DataSourceProviderType, SchemaDef } from '../src/schema/schema';

const schema = {
    provider: {
        type: 'sqlite',
        dialectConfigProvider: () => ({}),
    },
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
                comments: {
                    type: 'Comment',
                    array: true,
                    relation: {
                        opposite: 'post',
                    },
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
        Comment: {
            dbTable: 'Comment',
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
                content: {
                    type: 'String',
                },
                post: {
                    type: 'Post',
                    optional: true,
                    relation: {
                        fields: ['postId'],
                        references: ['id'],
                        opposite: 'comments',
                    },
                },
                postId: {
                    type: 'String',
                    foreignKeyFor: ['post'],
                    optional: true,
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'String' },
            },
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
                age: { type: 'Int', optional: true },
                user: {
                    type: 'User',
                    optional: true,
                    relation: {
                        fields: ['userId'],
                        references: ['id'],
                        opposite: 'profile',
                    },
                },
                userId: {
                    type: 'String',
                    optional: true,
                    unique: true,
                    foreignKeyFor: ['user'],
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'String' },
                userId: { type: 'String' },
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

export function getSchema<ProviderType extends DataSourceProviderType>(
    type: ProviderType
) {
    return {
        ...schema,
        provider: {
            type,
            dialectConfigProvider: () => ({}),
        },
    };
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
        .addUniqueConstraint('email_unique', ['email'])
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
        .createTable('Comment')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('createdAt', 'timestamp', (col) =>
            col.defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updatedAt', 'timestamp', (col) => col.notNull())
        .addColumn('content', 'varchar', (col) => col.notNull())
        .addColumn('postId', 'varchar', (col) => col.references('Post.id'))
        .execute();

    await db.$qb.schema
        .createTable('Profile')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('bio', 'varchar', (col) => col.notNull())
        .addColumn('age', 'integer')
        .addColumn('userId', 'varchar', (col) => col.unique())
        .addForeignKeyConstraint(
            'fk_profile_user',
            ['userId'],
            'User',
            ['id'],
            (cb) => cb.onDelete('cascade').onUpdate('cascade')
        )
        .execute();
}
