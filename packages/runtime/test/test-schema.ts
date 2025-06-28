import { ExpressionUtils, type DataSourceProviderType, type SchemaDef } from '../src/schema';

export const schema = {
    provider: {
        type: 'sqlite',
    },
    models: {
        User: {
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: ExpressionUtils.call('cuid'),
                    attributes: [
                        { name: '@id' },
                        {
                            name: '@default',
                            args: [
                                {
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                    },
                                },
                            ],
                        },
                    ],
                },
                email: {
                    type: 'String',
                    unique: true,
                    attributes: [
                        {
                            name: '@unique',
                        },
                    ],
                },
                name: {
                    type: 'String',
                    optional: true,
                },
                createdAt: {
                    type: 'DateTime',
                    default: ExpressionUtils.call('now'),
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    value: {
                                        kind: 'call',
                                        function: 'now',
                                    },
                                },
                            ],
                        },
                    ],
                },
                updatedAt: {
                    type: 'DateTime',
                    updatedAt: true,
                    attributes: [
                        {
                            name: '@updatedAt',
                        },
                    ],
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
            attributes: [
                // @@allow('all', auth() == this)
                {
                    name: '@@allow',
                    args: [
                        {
                            name: 'operation',
                            value: ExpressionUtils.literal('all'),
                        },
                        {
                            name: 'condition',
                            value: ExpressionUtils.binary(
                                ExpressionUtils.member(ExpressionUtils.call('auth'), ['id']),
                                '==',
                                ExpressionUtils.field('id'),
                            ),
                        },
                    ],
                },
                // @@allow('read', auth() != null)
                {
                    name: '@@allow',
                    args: [
                        {
                            name: 'operation',
                            value: ExpressionUtils.literal('read'),
                        },
                        {
                            name: 'condition',
                            value: ExpressionUtils.binary(ExpressionUtils.call('auth'), '!=', ExpressionUtils._null()),
                        },
                    ],
                },
            ],
        },
        Post: {
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: ExpressionUtils.call('cuid'),
                },
                createdAt: {
                    type: 'DateTime',
                    default: ExpressionUtils.call('now'),
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
            attributes: [
                // @@deny('all', auth() == null)
                {
                    name: '@@deny',
                    args: [
                        {
                            name: 'operation',
                            value: ExpressionUtils.literal('all'),
                        },
                        {
                            name: 'condition',
                            value: ExpressionUtils.binary(ExpressionUtils.call('auth'), '==', ExpressionUtils._null()),
                        },
                    ],
                },
                // @@allow('all', auth() == author)
                {
                    name: '@@allow',
                    args: [
                        {
                            name: 'operation',
                            value: ExpressionUtils.literal('all'),
                        },
                        {
                            name: 'condition',
                            value: ExpressionUtils.binary(
                                ExpressionUtils.member(ExpressionUtils.call('auth'), ['id']),
                                '==',
                                ExpressionUtils.field('authorId'),
                            ),
                        },
                    ],
                },
                // @@allow('read', published)
                {
                    name: '@@allow',
                    args: [
                        {
                            name: 'operation',
                            value: ExpressionUtils.literal('read'),
                        },
                        {
                            name: 'condition',
                            value: ExpressionUtils.field('published'),
                        },
                    ],
                },
            ],
        },
        Comment: {
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: ExpressionUtils.call('cuid'),
                },
                createdAt: {
                    type: 'DateTime',
                    default: ExpressionUtils.call('now'),
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
            fields: {
                id: {
                    type: 'String',
                    id: true,
                    default: ExpressionUtils.call('cuid'),
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
    authType: 'User',
    enums: {
        Role: {
            ADMIN: 'ADMIN',
            USER: 'USER',
        },
    },
    plugins: {},
} as const satisfies SchemaDef;

export function getSchema<ProviderType extends DataSourceProviderType>(type: ProviderType) {
    return {
        ...schema,
        provider: {
            type,
        },
    };
}
