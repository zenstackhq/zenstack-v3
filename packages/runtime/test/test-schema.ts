import type { SchemaDef } from '../src/schema';
import { call } from '../src/type-utils';

export const Schema = {
    provider: 'sqlite',
    models: {
        User: {
            fields: {
                id: {
                    type: 'String',
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
                    default: call('now()'),
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
            uniqueFields: {
                id: { type: 'String' },
                email: { type: 'String' },
            },
        },
        Post: {
            fields: {
                id: {
                    type: 'String',
                    generator: 'cuid',
                },
                createdAt: {
                    type: 'DateTime',
                    default: call('now()'),
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
            uniqueFields: {
                id: { type: 'String' },
            },
        },
        Foo: {
            fields: {
                id1: { type: 'Int' },
                id2: { type: 'Int' },
            },
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
