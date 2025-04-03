import Sqlite from 'better-sqlite3';
import { Expression } from '../src/schema/expression';
import type { DataSourceProviderType, SchemaDef } from '../src/schema/schema';

export const schema = {
    provider: {
        type: 'sqlite',
        dialectConfigProvider: () =>
            ({
                database: new Sqlite(':memory:'),
            } as object),
    },
    models: {
        User: {
            dbTable: 'User',
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: { call: 'cuid' },
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
                    default: { call: 'now' },
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
        },
        Post: {
            dbTable: 'Post',
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: { call: 'cuid' },
                },
                createdAt: {
                    type: 'DateTime',
                    default: { call: 'now' },
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
                        onUpdate: 'Cascade',
                        onDelete: 'Cascade',
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
                    default: { call: 'cuid' },
                },
                createdAt: {
                    type: 'DateTime',
                    default: { call: 'now' },
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
                        onUpdate: 'Cascade',
                        onDelete: 'Cascade',
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
                    default: { call: 'cuid' },
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
                        onUpdate: 'Cascade',
                        onDelete: 'Cascade',
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
    plugins: {
        policy: {
            authModel: 'User',
        },
    },
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
