import { ExpressionUtils } from '@zenstackhq/runtime/schema';
import { generateTsSchema } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('TypeScript schema generation tests', () => {
    it('generates correct data models', async () => {
        const { schema } = await generateTsSchema(`
model User {
    id String @id @default(uuid())
    name String
    email String @unique
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    posts Post[]

    @@map('users')
}

model Post {
    id String @id @default(cuid())
    title String
    published Boolean @default(false)
    author User @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId String
}
            `);

        expect(schema.provider).toMatchObject({
            type: 'sqlite',
        });

        expect(schema.models).toMatchObject({
            User: {
                fields: {
                    id: {
                        type: 'String',
                        id: true,
                        default: ExpressionUtils.call('uuid'),
                        attributes: [
                            { name: '@id' },
                            {
                                name: '@default',
                                args: [
                                    {
                                        value: {
                                            kind: 'call',
                                            function: 'uuid',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    name: { type: 'String' },
                    email: { type: 'String', unique: true },
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
                        attributes: [
                            {
                                name: '@updatedAt',
                            },
                        ],
                        updatedAt: true,
                    },
                    posts: {
                        type: 'Post',
                        array: true,
                        relation: {
                            opposite: 'author',
                        },
                    },
                },
                attributes: [
                    {
                        name: '@@map',
                        args: [{ name: 'name', value: { kind: 'literal' } }],
                    },
                ],
                idFields: ['id'],
                uniqueFields: {
                    id: { type: 'String' },
                    email: { type: 'String' },
                },
            },
            Post: {
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
                    title: { type: 'String' },
                    published: {
                        type: 'Boolean',
                        default: false,
                    },
                    authorId: { type: 'String' },
                    author: {
                        type: 'User',
                        relation: {
                            fields: ['authorId'],
                            references: ['id'],
                            onDelete: 'Cascade',
                            opposite: 'posts',
                        },
                        attributes: [
                            {
                                name: '@relation',
                                args: [
                                    {
                                        name: 'fields',
                                        value: {
                                            kind: 'array',
                                            items: [
                                                {
                                                    kind: 'field',
                                                    field: 'authorId',
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        name: 'references',
                                        value: {
                                            kind: 'array',
                                            items: [
                                                {
                                                    kind: 'field',
                                                    field: 'id',
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        name: 'onDelete',
                                        value: {
                                            kind: 'literal',
                                            value: 'Cascade',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                idFields: ['id'],
                uniqueFields: {
                    id: { type: 'String' },
                },
            },
        });
    });

    it('merges fields and attributes from mixins', async () => {
        const { schema } = await generateTsSchema(`
type Timestamped {
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}

type Named {
    name String
    @@unique([name])
}
    
model User with Timestamped Named {
    id String @id @default(uuid())
    email String @unique
}
        `);
        expect(schema).toMatchObject({
            models: {
                User: {
                    fields: {
                        id: { type: 'String' },
                        email: { type: 'String' },
                        createdAt: {
                            type: 'DateTime',
                            default: expect.objectContaining({ function: 'now', kind: 'call' }),
                        },
                        updatedAt: { type: 'DateTime', updatedAt: true },
                        name: { type: 'String' },
                    },
                    uniqueFields: expect.objectContaining({
                        name: { type: 'String' },
                    }),
                },
            },
        });
    });

    it('generates type definitions', async () => {
        const { schema } = await generateTsSchema(`
type Base {
    name String
    @@meta('foo', 'bar')
}

type Address with Base {
    street String
    city String
}
    `);
        expect(schema).toMatchObject({
            typeDefs: {
                Base: {
                    fields: {
                        name: { type: 'String' },
                    },
                    attributes: [
                        {
                            name: '@@meta',
                            args: [
                                { name: 'name', value: { kind: 'literal', value: 'foo' } },
                                { name: 'value', value: { kind: 'literal', value: 'bar' } },
                            ],
                        },
                    ],
                },
                Address: {
                    fields: {
                        street: { type: 'String' },
                        city: { type: 'String' },
                    },
                    attributes: [
                        {
                            name: '@@meta',
                            args: [
                                { name: 'name', value: { kind: 'literal', value: 'foo' } },
                                { name: 'value', value: { kind: 'literal', value: 'bar' } },
                            ],
                        },
                    ],
                },
            },
        });
    });

    it('merges fields and attributes from base models', async () => {
        const { schema } = await generateTsSchema(`
model Base {
    id String @id @default(uuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    type String
    @@delegate(type)
}

model User extends Base {
    email String @unique
}
        `);
        expect(schema).toMatchObject({
            models: {
                Base: {
                    fields: {
                        id: {
                            type: 'String',
                            id: true,
                            default: expect.objectContaining({ function: 'uuid', kind: 'call' }),
                        },
                        createdAt: {
                            type: 'DateTime',
                            default: expect.objectContaining({ function: 'now', kind: 'call' }),
                        },
                        updatedAt: { type: 'DateTime', updatedAt: true },
                        type: { type: 'String' },
                    },
                    attributes: [
                        {
                            name: '@@delegate',
                            args: [{ name: 'discriminator', value: { kind: 'field', field: 'type' } }],
                        },
                    ],
                    isDelegate: true,
                },
                User: {
                    baseModel: 'Base',
                    fields: {
                        id: { type: 'String' },
                        createdAt: {
                            type: 'DateTime',
                            default: expect.objectContaining({ function: 'now', kind: 'call' }),
                            originModel: 'Base',
                        },
                        updatedAt: { type: 'DateTime', updatedAt: true, originModel: 'Base' },
                        type: { type: 'String', originModel: 'Base' },
                        email: { type: 'String' },
                    },
                    uniqueFields: expect.objectContaining({
                        email: { type: 'String' },
                    }),
                },
            },
        });
    });
});
