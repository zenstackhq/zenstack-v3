import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Compound ID tests', () => {
    describe('to-one relation', () => {
        const schema = `
        model User {
            id1 Int
            id2 Int
            name String
            posts Post[]
            @@id([id1, id2])
        }

        model Post {
            id Int @id
            title String
            author User? @relation(fields: [authorId1, authorId2], references: [id1, id2], onDelete: Cascade, onUpdate: Cascade)
            authorId1 Int?
            authorId2 Int?
        }
    `;

        it('works with create', async () => {
            const client = await createTestClient(schema);
            await expect(
                client.user.create({
                    data: {
                        id1: 1,
                        id2: 1,
                        name: 'User1',
                    },
                }),
            ).resolves.toMatchObject({
                id1: 1,
                id2: 1,
                name: 'User1',
            });

            await expect(
                client.post.create({
                    data: {
                        id: 1,
                        title: 'Post1',
                        author: {
                            connect: { id1_id2: { id1: 1, id2: 2 } },
                        },
                    },
                }),
            ).toBeRejectedNotFound();

            await expect(
                client.post.create({
                    data: {
                        id: 1,
                        title: 'Post1',
                        author: {
                            connect: { id1_id2: { id1: 1, id2: 1 } },
                        },
                    },
                }),
            ).resolves.toMatchObject({
                authorId1: 1,
                authorId2: 1,
            });
        });

        it('works with findUnique', async () => {
            const client = await createTestClient(schema);

            await client.user.create({
                data: {
                    id1: 1,
                    id2: 1,
                    name: 'User1',
                    posts: {
                        create: {
                            id: 1,
                            title: 'Post1',
                        },
                    },
                },
            });

            await expect(
                client.user.findUnique({
                    where: {
                        id1_id2: {
                            id1: 1,
                            id2: 2,
                        },
                    },
                }),
            ).toResolveNull();

            await expect(
                client.user.findUnique({
                    where: {
                        id1_id2: {
                            id1: 1,
                            id2: 1,
                        },
                    },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findUnique({
                    where: {
                        id1: 1,
                    },
                }),
            ).rejects.toThrow(/id1_id2/);
        });

        it('works with update', async () => {
            const client = await createTestClient(schema);

            await client.user.create({
                data: { id1: 1, id2: 1, name: 'User1' },
            });

            // toplevel
            await expect(
                client.user.update({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    data: { name: 'User1-1' },
                }),
            ).resolves.toMatchObject({ name: 'User1-1' });

            // toplevel, not found
            await expect(
                client.user.update({
                    where: { id1_id2: { id1: 1, id2: 1 }, id1: 2 },
                    data: { name: 'User1-1' },
                }),
            ).toBeRejectedNotFound();

            await client.post.create({
                data: {
                    id: 1,
                    title: 'Post1',
                },
            });

            // connect
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: {
                        author: {
                            connect: { id1_id2: { id1: 1, id2: 1 } },
                        },
                    },
                }),
            ).resolves.toMatchObject({ authorId1: 1, authorId2: 1 });

            // disconnect not found
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: { author: { disconnect: { id1: 1, id2: 2 } } },
                }),
            ).resolves.toMatchObject({ authorId1: 1, authorId2: 1 });

            // disconnect found
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: { author: { disconnect: { id1: 1, id2: 1 } } },
                }),
            ).resolves.toMatchObject({ authorId1: null, authorId2: null });

            // reconnect
            client.post.update({
                where: { id: 1 },
                data: {
                    author: {
                        connect: { id1_id2: { id1: 1, id2: 1 } },
                    },
                },
            });

            // disconnect
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: { author: { disconnect: true } },
                }),
            ).resolves.toMatchObject({ authorId1: null, authorId2: null });

            // connectOrCreate - connect
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: {
                        author: {
                            connectOrCreate: {
                                where: { id1_id2: { id1: 1, id2: 1 } },
                                create: {
                                    id1: 1,
                                    id2: 1,
                                    name: 'User1-new',
                                },
                            },
                        },
                    },
                    include: {
                        author: true,
                    },
                }),
            ).resolves.toMatchObject({
                author: {
                    id1: 1,
                    id2: 1,
                    name: 'User1-1',
                },
            });

            // connectOrCreate - create
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: {
                        author: {
                            connectOrCreate: {
                                where: { id1_id2: { id1: 2, id2: 2 } },
                                create: {
                                    id1: 2,
                                    id2: 2,
                                    name: 'User2',
                                },
                            },
                        },
                    },
                    include: {
                        author: true,
                    },
                }),
            ).resolves.toMatchObject({
                author: {
                    id1: 2,
                    id2: 2,
                    name: 'User2',
                },
            });

            // upsert - create
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: {
                        author: {
                            upsert: {
                                where: { id1_id2: { id1: 3, id2: 3 } },
                                create: { id1: 3, id2: 3, name: 'User3' },
                                update: { name: 'User3-1' },
                            },
                        },
                    },
                    include: { author: true },
                }),
            ).resolves.toMatchObject({ author: { name: 'User3' } });

            // upsert - update
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: {
                        author: {
                            upsert: {
                                where: { id1_id2: { id1: 3, id2: 3 } },
                                create: { id1: 3, id2: 3, name: 'User3' },
                                update: { name: 'User3-1' },
                            },
                        },
                    },
                    include: { author: true },
                }),
            ).resolves.toMatchObject({ author: { name: 'User3-1' } });

            // delete, and post is cascade deleted
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: { author: { delete: true } },
                }),
            ).toResolveNull();

            // delete not found
            await expect(
                client.post.update({
                    where: { id: 1 },
                    data: { author: { delete: true } },
                }),
            ).toBeRejectedNotFound();
        });

        it('works with upsert', async () => {
            const client = await createTestClient(schema);

            // toplevel, create
            await expect(
                client.user.upsert({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    create: { id1: 1, id2: 1, name: 'User1' },
                    update: { name: 'User1-1' },
                }),
            ).resolves.toMatchObject({ name: 'User1' });

            // toplevel, update
            await expect(
                client.user.upsert({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    create: { id1: 1, id2: 1, name: 'User1' },
                    update: { name: 'User1-1' },
                }),
            ).resolves.toMatchObject({ name: 'User1-1' });
        });

        it('works with delete', async () => {
            const client = await createTestClient(schema);

            await client.user.create({
                data: { id1: 1, id2: 1, name: 'User1' },
            });

            // toplevel
            await expect(
                client.user.delete({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                }),
            ).resolves.toMatchObject({ name: 'User1' });

            // toplevel
            await expect(
                client.user.delete({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                }),
            ).toBeRejectedNotFound();
        });
    });

    describe('to-many-relation', () => {
        const schema = `
        model User {
            id Int @id
            name String
            posts Post[]
        }

        model Post {
            id1 Int
            id2 Int
            title String
            author User? @relation(fields: [authorId], references: [id])
            authorId Int?
            @@id([id1, id2])
        }
    `;
        it('works with create', async () => {
            const client = await createTestClient(schema);

            await client.post.create({
                data: {
                    id1: 1,
                    id2: 1,
                    title: 'Post1',
                },
            });

            await expect(
                client.user.create({
                    data: {
                        id: 1,
                        name: 'User1',
                        posts: { connect: { id1_id2: { id1: 1, id2: 1 } } },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ id1: 1, id2: 1 })],
            });

            await expect(
                client.user.create({
                    data: {
                        id: 2,
                        name: 'User2',
                        posts: { connect: { id1_id2: { id1: 1, id2: 2 } } },
                    },
                    include: { posts: true },
                }),
            ).toBeRejectedNotFound();

            // connectOrCreate - connect
            await expect(
                client.user.create({
                    data: {
                        id: 2,
                        name: 'User2',
                        posts: {
                            connectOrCreate: {
                                where: { id1_id2: { id1: 1, id2: 1 } },
                                create: {
                                    id1: 1,
                                    id2: 1,
                                    title: 'Post1-new',
                                },
                            },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ title: 'Post1' })],
            });

            // connectOrCreate - create
            await expect(
                client.user.create({
                    data: {
                        id: 3,
                        name: 'User3',
                        posts: {
                            connectOrCreate: {
                                where: { id1_id2: { id1: 2, id2: 2 } },
                                create: {
                                    id1: 2,
                                    id2: 2,
                                    title: 'Post2',
                                },
                            },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ title: 'Post2' })],
            });
        });

        it('works with update', async () => {
            const client = await createTestClient(schema);

            await client.user.create({
                data: {
                    id: 1,
                    name: 'User1',
                    posts: {
                        create: {
                            id1: 1,
                            id2: 1,
                            title: 'Post1',
                        },
                    },
                },
            });

            // toplevel
            await expect(
                client.post.update({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    data: {
                        title: 'Post1-1',
                    },
                }),
            ).resolves.toMatchObject({ title: 'Post1-1' });

            // create
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            create: {
                                id1: 2,
                                id2: 2,
                                title: 'Post2',
                            },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ title: 'Post1-1' }), expect.objectContaining({ title: 'Post2' })],
            });

            // connect - not found
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            connect: { id1_id2: { id1: 3, id2: 3 } },
                        },
                    },
                    include: { posts: true },
                }),
            ).toBeRejectedNotFound();

            await client.post.create({
                data: {
                    id1: 3,
                    id2: 3,
                    title: 'Post3',
                },
            });

            // connect
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            connect: { id1_id2: { id1: 3, id2: 3 } },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [
                    expect.objectContaining({ title: 'Post1-1' }),
                    expect.objectContaining({ title: 'Post2' }),
                    expect.objectContaining({ title: 'Post3' }),
                ],
            });

            // disconnect - not giving unique filter
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            disconnect: { id1: 1, id2: 1 },
                        },
                    },
                }),
            ).rejects.toThrow(/Invalid/);

            // disconnect
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            disconnect: { id1_id2: { id1: 1, id2: 1 } },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ title: 'Post2' }), expect.objectContaining({ title: 'Post3' })],
            });

            // disconnect not found
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            disconnect: { id1_id2: { id1: 10, id2: 10 } },
                        },
                    },
                }),
            ).toResolveTruthy();

            // update
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            update: {
                                where: {
                                    id1_id2: { id1: 2, id2: 2 },
                                },
                                data: { title: 'Post2-new' },
                            },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: expect.arrayContaining([expect.objectContaining({ title: 'Post2-new' })]),
            });

            // delete
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            delete: { id1_id2: { id1: 3, id2: 3 } },
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: expect.not.arrayContaining([{ title: 'Post3' }]),
            });

            // set
            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        posts: {
                            set: [{ id1_id2: { id1: 1, id2: 1 } }, { id1_id2: { id1: 2, id2: 2 } }],
                        },
                    },
                    include: { posts: true },
                }),
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ id1: 1, id2: 1 }), expect.objectContaining({ id1: 2, id2: 2 })],
            });
        });

        it('works with upsert', async () => {
            const client = await createTestClient(schema);

            // create
            await expect(
                client.post.upsert({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    create: { id1: 1, id2: 1, title: 'Post1' },
                    update: { title: 'Post1-1' },
                }),
            ).resolves.toMatchObject({ title: 'Post1' });

            // update
            await expect(
                client.post.upsert({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                    create: { id1: 1, id2: 1, title: 'Post1' },
                    update: { title: 'Post1-1' },
                }),
            ).resolves.toMatchObject({ title: 'Post1-1' });
        });

        it('works with delete', async () => {
            const client = await createTestClient(schema);

            await client.post.create({
                data: { id1: 1, id2: 1, title: 'Post1' },
            });

            // toplevel
            await expect(
                client.post.delete({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                }),
            ).resolves.toMatchObject({ title: 'Post1' });

            // toplevel
            await expect(
                client.post.delete({
                    where: { id1_id2: { id1: 1, id2: 1 } },
                }),
            ).toBeRejectedNotFound();
        });
    });
});
