import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '@zenstackhq/testtools';

describe('Many-to-many relation tests', () => {
    let client: any;

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with explicit many-to-many relation', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                tags UserTag[]
            }

            model Tag {
                id Int @id @default(autoincrement())
                name String
                users UserTag[]
            }

            model UserTag {
                id Int @id @default(autoincrement())
                userId Int
                tagId Int
                user User @relation(fields: [userId], references: [id])
                tag Tag @relation(fields: [tagId], references: [id])
                @@unique([userId, tagId])
            }
        `,
        );

        await client.user.create({ data: { id: 1, name: 'User1' } });
        await client.user.create({ data: { id: 2, name: 'User2' } });
        await client.tag.create({ data: { id: 1, name: 'Tag1' } });
        await client.tag.create({ data: { id: 2, name: 'Tag2' } });

        await client.userTag.create({ data: { userId: 1, tagId: 1 } });
        await client.userTag.create({ data: { userId: 1, tagId: 2 } });
        await client.userTag.create({ data: { userId: 2, tagId: 1 } });

        await expect(
            client.user.findMany({
                include: { tags: { include: { tag: true } } },
            }),
        ).resolves.toMatchObject([
            expect.objectContaining({
                name: 'User1',
                tags: [
                    expect.objectContaining({
                        tag: expect.objectContaining({ name: 'Tag1' }),
                    }),
                    expect.objectContaining({
                        tag: expect.objectContaining({ name: 'Tag2' }),
                    }),
                ],
            }),
            expect.objectContaining({
                name: 'User2',
                tags: [
                    expect.objectContaining({
                        tag: expect.objectContaining({ name: 'Tag1' }),
                    }),
                ],
            }),
        ]);
    });

    describe.each([{ relationName: undefined }, { relationName: 'myM2M' }])(
        'Implicit many-to-many relation (relation: $relationName)',
        ({ relationName }) => {
            beforeEach(async () => {
                client = await createTestClient(
                    `
                model User {
                    id Int @id @default(autoincrement())
                    name String
                    profile Profile?
                    tags Tag[] ${relationName ? `@relation("${relationName}")` : ''}
                }

                model Tag {
                    id Int @id @default(autoincrement())
                    name String
                    users User[] ${relationName ? `@relation("${relationName}")` : ''}
                }

                model Profile {
                    id Int @id @default(autoincrement())
                    age Int
                    user User @relation(fields: [userId], references: [id])
                    userId Int @unique
                }
                `,
                    {
                        usePrismaPush: true,
                    },
                );
            });

            it('works with find', async () => {
                await client.user.create({
                    data: {
                        id: 1,
                        name: 'User1',
                        tags: {
                            create: [
                                { id: 1, name: 'Tag1' },
                                { id: 2, name: 'Tag2' },
                            ],
                        },
                        profile: {
                            create: {
                                id: 1,
                                age: 20,
                            },
                        },
                    },
                });

                await client.user.create({
                    data: {
                        id: 2,
                        name: 'User2',
                    },
                });

                // include without filter
                await expect(
                    client.user.findFirst({
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ name: 'Tag1' }), expect.objectContaining({ name: 'Tag2' })],
                });

                await expect(
                    client.profile.findFirst({
                        include: {
                            user: {
                                include: { tags: true },
                            },
                        },
                    }),
                ).resolves.toMatchObject({
                    user: expect.objectContaining({
                        tags: [expect.objectContaining({ name: 'Tag1' }), expect.objectContaining({ name: 'Tag2' })],
                    }),
                });

                await expect(
                    client.user.findUnique({
                        where: { id: 2 },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [],
                });

                // include with filter
                await expect(
                    client.user.findFirst({
                        where: { id: 1 },
                        include: { tags: { where: { name: 'Tag1' } } },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ name: 'Tag1' })],
                });

                // filter with m2m
                await expect(
                    client.user.findMany({
                        where: { tags: { some: { name: 'Tag1' } } },
                    }),
                ).resolves.toEqual([
                    expect.objectContaining({
                        name: 'User1',
                    }),
                ]);
                await expect(
                    client.user.findMany({
                        where: { tags: { none: { name: 'Tag1' } } },
                    }),
                ).resolves.toEqual([
                    expect.objectContaining({
                        name: 'User2',
                    }),
                ]);
            });

            it('works with create', async () => {
                // create
                await expect(
                    client.user.create({
                        data: {
                            id: 1,
                            name: 'User1',
                            tags: {
                                create: [
                                    {
                                        id: 1,
                                        name: 'Tag1',
                                    },
                                    {
                                        id: 2,
                                        name: 'Tag2',
                                    },
                                ],
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ name: 'Tag1' }), expect.objectContaining({ name: 'Tag2' })],
                });

                // connect
                await expect(
                    client.user.create({
                        data: {
                            id: 2,
                            name: 'User2',
                            tags: { connect: { id: 1 } },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ name: 'Tag1' })],
                });

                // connectOrCreate
                await expect(
                    client.user.create({
                        data: {
                            id: 3,
                            name: 'User3',
                            tags: {
                                connectOrCreate: {
                                    where: { id: 1 },
                                    create: { id: 1, name: 'Tag1' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 1, name: 'Tag1' })],
                });

                await expect(
                    client.user.create({
                        data: {
                            id: 4,
                            name: 'User4',
                            tags: {
                                connectOrCreate: {
                                    where: { id: 3 },
                                    create: { id: 3, name: 'Tag3' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 3, name: 'Tag3' })],
                });
            });

            it('works with update', async () => {
                // create
                await client.user.create({
                    data: {
                        id: 1,
                        name: 'User1',
                        tags: {
                            create: [
                                {
                                    id: 1,
                                    name: 'Tag1',
                                },
                            ],
                        },
                    },
                    include: { tags: true },
                });

                // create
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                create: [
                                    {
                                        id: 2,
                                        name: 'Tag2',
                                    },
                                ],
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
                });

                await client.tag.create({
                    data: {
                        id: 3,
                        name: 'Tag3',
                    },
                });

                // connect
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { connect: { id: 3 } } },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [
                        expect.objectContaining({ id: 1 }),
                        expect.objectContaining({ id: 2 }),
                        expect.objectContaining({ id: 3 }),
                    ],
                });
                // connecting a connected entity is no-op
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { connect: { id: 3 } } },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [
                        expect.objectContaining({ id: 1 }),
                        expect.objectContaining({ id: 2 }),
                        expect.objectContaining({ id: 3 }),
                    ],
                });

                // disconnect - not found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: { disconnect: { id: 3, name: 'not found' } },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [
                        expect.objectContaining({ id: 1 }),
                        expect.objectContaining({ id: 2 }),
                        expect.objectContaining({ id: 3 }),
                    ],
                });

                // disconnect - found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { disconnect: { id: 3 } } },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
                });

                await expect(
                    client.$qbRaw
                        .selectFrom(relationName ? `_${relationName}` : '_TagToUser')
                        .selectAll()
                        .where('B', '=', 1) // user id
                        .where('A', '=', 3) // tag id
                        .execute(),
                ).resolves.toHaveLength(0);

                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { set: [{ id: 2 }, { id: 3 }] } },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 3 })],
                });

                // update - not found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                update: {
                                    where: { id: 1 },
                                    data: { name: 'Tag1-updated' },
                                },
                            },
                        },
                    }),
                ).toBeRejectedNotFound();

                // update - found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                update: {
                                    where: { id: 2 },
                                    data: { name: 'Tag2-updated' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: expect.arrayContaining([
                        expect.objectContaining({
                            id: 2,
                            name: 'Tag2-updated',
                        }),
                        expect.objectContaining({ id: 3, name: 'Tag3' }),
                    ]),
                });

                // updateMany
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                updateMany: {
                                    where: { id: { not: 2 } },
                                    data: { name: 'Tag3-updated' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [
                        expect.objectContaining({
                            id: 2,
                            name: 'Tag2-updated',
                        }),
                        expect.objectContaining({
                            id: 3,
                            name: 'Tag3-updated',
                        }),
                    ],
                });

                await expect(client.tag.findUnique({ where: { id: 1 } })).resolves.toMatchObject({
                    name: 'Tag1',
                });

                // upsert - update
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                upsert: {
                                    where: { id: 3 },
                                    create: { id: 3, name: 'Tag4' },
                                    update: { name: 'Tag3-updated-1' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [
                        expect.objectContaining({
                            id: 2,
                            name: 'Tag2-updated',
                        }),
                        expect.objectContaining({
                            id: 3,
                            name: 'Tag3-updated-1',
                        }),
                    ],
                });

                // upsert - create
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: {
                                upsert: {
                                    where: { id: 4 },
                                    create: { id: 4, name: 'Tag4' },
                                    update: { name: 'Tag4' },
                                },
                            },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: expect.arrayContaining([expect.objectContaining({ id: 4, name: 'Tag4' })]),
                });

                // delete - not found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { delete: { id: 1 } } },
                    }),
                ).toBeRejectedNotFound();

                // delete - found
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: { tags: { delete: { id: 2 } } },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 4 })],
                });
                await expect(client.tag.findUnique({ where: { id: 2 } })).toResolveNull();

                // deleteMany
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            tags: { deleteMany: { id: { in: [1, 2, 3] } } },
                        },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 4 })],
                });
                await expect(client.tag.findUnique({ where: { id: 3 } })).toResolveNull();
                await expect(client.tag.findUnique({ where: { id: 1 } })).toResolveTruthy();
            });

            it('works with delete', async () => {
                await client.user.create({
                    data: {
                        id: 1,
                        name: 'User1',
                        tags: {
                            create: [
                                { id: 1, name: 'Tag1' },
                                { id: 2, name: 'Tag2' },
                            ],
                        },
                    },
                });

                // cascade from tag
                await client.tag.delete({
                    where: { id: 1 },
                });
                await expect(
                    client.user.findUnique({
                        where: { id: 1 },
                        include: { tags: true },
                    }),
                ).resolves.toMatchObject({
                    tags: [expect.objectContaining({ id: 2 })],
                });

                // cascade from user
                await client.user.delete({
                    where: { id: 1 },
                });
                await expect(
                    client.tag.findUnique({
                        where: { id: 2 },
                        include: { users: true },
                    }),
                ).resolves.toMatchObject({
                    users: [],
                });
            });
        },
    );
});
