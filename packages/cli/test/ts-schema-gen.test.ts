import { describe, expect, it } from 'vitest';
import { generateTsSchema } from './utils';

describe('TypeScript schema generation tests', () => {
    it('generates correct data models', async () => {
        const schema = await generateTsSchema(`
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
            dialectConfigProvider: expect.any(Function),
        });

        expect(schema.models).toMatchObject({
            User: {
                fields: {
                    id: {
                        type: 'String',
                        id: true,
                        default: { call: 'uuid' },
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
                        default: { call: 'now' },
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
                        default: { call: 'cuid' },
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
                                                    kind: 'ref',
                                                    model: 'Post',
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
                                                    kind: 'ref',
                                                    model: 'User',
                                                    field: 'id',
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        name: 'onDelete',
                                        value: {
                                            kind: 'ref',
                                            model: 'ReferentialAction',
                                            field: 'Cascade',
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
});
