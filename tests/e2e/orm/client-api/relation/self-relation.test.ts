import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, describe, expect, it } from 'vitest';

describe('Self relation tests', () => {
    let client: any;

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with one-to-one self relation', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                spouse User? @relation("Marriage", fields: [spouseId], references: [id])
                marriedTo User? @relation("Marriage")
                spouseId Int? @unique
            }
        `,
            {
                usePrismaPush: true,
            },
        );

        // Create first user
        const alice = await client.user.create({
            data: { name: 'Alice' },
        });

        // Create second user and establish marriage relationship
        await expect(
            client.user.create({
                data: {
                    name: 'Bob',
                    spouse: { connect: { id: alice.id } },
                },
                include: { spouse: true },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            spouse: { name: 'Alice' },
        });

        // Verify the reverse relationship
        await expect(
            client.user.findUnique({
                where: { id: alice.id },
                include: { marriedTo: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            marriedTo: { name: 'Bob' },
        });

        // Test creating with nested create
        await expect(
            client.user.create({
                data: {
                    name: 'Charlie',
                    spouse: {
                        create: { name: 'Diana' },
                    },
                },
                include: { spouse: true },
            }),
        ).resolves.toMatchObject({
            name: 'Charlie',
            spouse: { name: 'Diana' },
        });

        // Verify Diana is married to Charlie
        await expect(
            client.user.findFirst({
                where: { name: 'Diana' },
                include: { marriedTo: true },
            }),
        ).resolves.toMatchObject({
            name: 'Diana',
            marriedTo: { name: 'Charlie' },
        });

        // Test disconnecting relationship
        const bob = await client.user.findFirst({
            where: { name: 'Bob' },
        });

        await expect(
            client.user.update({
                where: { id: bob!.id },
                data: {
                    spouse: { disconnect: true },
                },
                include: { spouse: true, marriedTo: true },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            spouse: null,
            marriedTo: null,
        });

        // Verify Alice is also disconnected
        await expect(
            client.user.findUnique({
                where: { id: alice.id },
                include: { spouse: true, marriedTo: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            spouse: null,
            marriedTo: null,
        });
    });

    it('works with one-to-many self relation', async () => {
        client = await createTestClient(
            `
            model Category {
                id Int @id @default(autoincrement())
                name String
                parent Category? @relation("CategoryHierarchy", fields: [parentId], references: [id])
                children Category[] @relation("CategoryHierarchy")
                parentId Int?
            }
        `,
            {
                usePrismaPush: true,
            },
        );

        // Create parent category
        const parent = await client.category.create({
            data: {
                name: 'Electronics',
            },
        });

        // Create children with parent
        await expect(
            client.category.create({
                data: {
                    name: 'Smartphones',
                    parent: { connect: { id: parent.id } },
                },
                include: { parent: true },
            }),
        ).resolves.toMatchObject({
            name: 'Smartphones',
            parent: { name: 'Electronics' },
        });

        // Create child using nested create
        await expect(
            client.category.create({
                data: {
                    name: 'Gaming',
                    children: {
                        create: [{ name: 'Console Games' }, { name: 'PC Games' }],
                    },
                },
                include: { children: true },
            }),
        ).resolves.toMatchObject({
            name: 'Gaming',
            children: [
                expect.objectContaining({ name: 'Console Games' }),
                expect.objectContaining({ name: 'PC Games' }),
            ],
        });

        // Query with full hierarchy
        await expect(
            client.category.findFirst({
                where: { name: 'Electronics' },
                include: {
                    children: {
                        include: { parent: true },
                    },
                },
            }),
        ).resolves.toMatchObject({
            name: 'Electronics',
            children: [
                expect.objectContaining({
                    name: 'Smartphones',
                    parent: expect.objectContaining({ name: 'Electronics' }),
                }),
            ],
        });

        // Test relation manipulation with update - move child to different parent
        const gaming = await client.category.findFirst({ where: { name: 'Gaming' } });
        const smartphone = await client.category.findFirst({ where: { name: 'Smartphones' } });

        await expect(
            client.category.update({
                where: { id: smartphone.id },
                data: {
                    parent: { connect: { id: gaming.id } },
                },
                include: { parent: true },
            }),
        ).resolves.toMatchObject({
            name: 'Smartphones',
            parent: { name: 'Gaming' },
        });

        // Test update to disconnect parent (make orphan)
        await expect(
            client.category.update({
                where: { id: smartphone.id },
                data: {
                    parent: { disconnect: true },
                },
                include: { parent: true },
            }),
        ).resolves.toMatchObject({
            name: 'Smartphones',
            parent: null,
        });

        // Test update to add new children to existing parent
        const newChild = await client.category.create({ data: { name: 'Accessories' } });

        await expect(
            client.category.update({
                where: { id: parent.id },
                data: {
                    children: { connect: { id: newChild.id } },
                },
                include: { children: true },
            }),
        ).resolves.toMatchObject({
            name: 'Electronics',
            children: expect.arrayContaining([expect.objectContaining({ name: 'Accessories' })]),
        });

        // Test nested relation delete - delete specific children via update
        const consoleGames = await client.category.findFirst({ where: { name: 'Console Games' } });

        await expect(
            client.category.update({
                where: { id: gaming.id },
                data: {
                    children: {
                        delete: { id: consoleGames.id },
                    },
                },
                include: { children: true },
            }),
        ).resolves.toMatchObject({
            name: 'Gaming',
            children: [expect.objectContaining({ name: 'PC Games' })],
        });

        // Verify the deleted child no longer exists
        await expect(client.category.findFirst({ where: { id: consoleGames.id } })).resolves.toBeNull();

        // Test nested delete with multiple children
        await expect(
            client.category.update({
                where: { id: gaming.id },
                data: {
                    children: {
                        deleteMany: {
                            name: { startsWith: 'PC' },
                        },
                    },
                },
                include: { children: true },
            }),
        ).resolves.toMatchObject({
            name: 'Gaming',
            children: [],
        });

        // Test update with nested delete using where condition
        await expect(
            client.category.update({
                where: { id: parent.id },
                data: {
                    children: {
                        deleteMany: {
                            name: 'Accessories',
                        },
                    },
                },
                include: { children: true },
            }),
        ).resolves.toMatchObject({
            name: 'Electronics',
            children: [],
        });
    });

    it('works with many-to-many self relation', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                following User[] @relation("UserFollows")
                followers User[] @relation("UserFollows")
            }
        `,
            {
                usePrismaPush: true,
            },
        );

        // Create users
        const user1 = await client.user.create({ data: { name: 'Alice' } });
        const user2 = await client.user.create({ data: { name: 'Bob' } });
        const user3 = await client.user.create({ data: { name: 'Charlie' } });

        // Alice follows Bob and Charlie
        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        connect: [{ id: user2.id }, { id: user3.id }],
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: [expect.objectContaining({ name: 'Bob' }), expect.objectContaining({ name: 'Charlie' })],
        });

        // Bob follows Charlie
        await client.user.update({
            where: { id: user2.id },
            data: {
                following: { connect: { id: user3.id } },
            },
        });

        // Check Bob's followers (should include Alice)
        await expect(
            client.user.findUnique({
                where: { id: user2.id },
                include: { followers: true },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            followers: [expect.objectContaining({ name: 'Alice' })],
        });

        // Check Charlie's followers (should include Alice and Bob)
        await expect(
            client.user.findUnique({
                where: { id: user3.id },
                include: { followers: true },
            }),
        ).resolves.toMatchObject({
            name: 'Charlie',
            followers: [expect.objectContaining({ name: 'Alice' }), expect.objectContaining({ name: 'Bob' })],
        });

        // Test filtering with self relation
        await expect(
            client.user.findMany({
                where: {
                    followers: {
                        some: { name: 'Alice' },
                    },
                },
            }),
        ).resolves.toEqual([expect.objectContaining({ name: 'Bob' }), expect.objectContaining({ name: 'Charlie' })]);

        // Test disconnect operation
        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        disconnect: { id: user2.id },
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: [expect.objectContaining({ name: 'Charlie' })],
        });

        // Verify Bob no longer has Alice as follower
        await expect(
            client.user.findUnique({
                where: { id: user2.id },
                include: { followers: true },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            followers: [],
        });

        // Test set operation (replace all following)
        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        set: [{ id: user2.id }],
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: [expect.objectContaining({ name: 'Bob' })],
        });

        // Verify Charlie no longer has Alice as follower after set
        await expect(
            client.user.findUnique({
                where: { id: user3.id },
                include: { followers: true },
            }),
        ).resolves.toMatchObject({
            name: 'Charlie',
            followers: [expect.objectContaining({ name: 'Bob' })],
        });

        // Test connectOrCreate with existing user
        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        connectOrCreate: {
                            where: { id: user3.id },
                            create: { name: 'Charlie' },
                        },
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: [expect.objectContaining({ name: 'Bob' }), expect.objectContaining({ name: 'Charlie' })],
        });

        // Test connectOrCreate with new user
        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        connectOrCreate: {
                            where: { id: 999 },
                            create: { name: 'David' },
                        },
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: expect.arrayContaining([
                expect.objectContaining({ name: 'Bob' }),
                expect.objectContaining({ name: 'Charlie' }),
                expect.objectContaining({ name: 'David' }),
            ]),
        });

        // Test create operation within update
        await expect(
            client.user.update({
                where: { id: user2.id },
                data: {
                    following: {
                        create: { name: 'Eve' },
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            following: expect.arrayContaining([
                expect.objectContaining({ name: 'Charlie' }),
                expect.objectContaining({ name: 'Eve' }),
            ]),
        });

        // Test deleteMany operation (disconnect and delete)
        const davidUser = await client.user.findFirst({ where: { name: 'David' } });
        const eveUser = await client.user.findFirst({ where: { name: 'Eve' } });

        await expect(
            client.user.update({
                where: { id: user1.id },
                data: {
                    following: {
                        deleteMany: {
                            name: { in: ['David', 'Eve'] },
                        },
                    },
                },
                include: { following: true },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            following: [expect.objectContaining({ name: 'Bob' }), expect.objectContaining({ name: 'Charlie' })],
        });

        // Verify David was deleted from database
        await expect(client.user.findUnique({ where: { id: davidUser!.id } })).toResolveNull();
        await expect(client.user.findUnique({ where: { id: eveUser!.id } })).toResolveTruthy();
    });

    it('works with explicit self-referencing many-to-many', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                followingRelations UserFollow[] @relation("Follower")
                followerRelations UserFollow[] @relation("Following")
            }

            model UserFollow {
                id Int @id @default(autoincrement())
                follower User @relation("Follower", fields: [followerId], references: [id])
                following User @relation("Following", fields: [followingId], references: [id])
                followerId Int
                followingId Int
                createdAt DateTime @default(now())
                @@unique([followerId, followingId])
            }
        `,
        );

        const user1 = await client.user.create({ data: { name: 'Alice' } });
        const user2 = await client.user.create({ data: { name: 'Bob' } });

        // Create follow relationship
        await client.userFollow.create({
            data: {
                followerId: user1.id,
                followingId: user2.id,
            },
        });

        // Query following relationships
        await expect(
            client.user.findUnique({
                where: { id: user1.id },
                include: {
                    followingRelations: {
                        include: { following: true },
                    },
                },
            }),
        ).resolves.toMatchObject({
            name: 'Alice',
            followingRelations: [
                expect.objectContaining({
                    following: expect.objectContaining({ name: 'Bob' }),
                }),
            ],
        });

        // Query follower relationships
        await expect(
            client.user.findUnique({
                where: { id: user2.id },
                include: {
                    followerRelations: {
                        include: { follower: true },
                    },
                },
            }),
        ).resolves.toMatchObject({
            name: 'Bob',
            followerRelations: [
                expect.objectContaining({
                    follower: expect.objectContaining({ name: 'Alice' }),
                }),
            ],
        });
    });

    it('works with multiple self relations on same model', async () => {
        client = await createTestClient(
            `
            model Person {
                id Int @id @default(autoincrement())
                name String
                manager Person? @relation("Management", fields: [managerId], references: [id])
                reports Person[] @relation("Management")
                managerId Int?
                
                mentor Person? @relation("Mentorship", fields: [mentorId], references: [id])
                mentees Person[] @relation("Mentorship")
                mentorId Int?
            }
        `,
            { usePrismaPush: true },
        );

        // Create CEO
        const ceo = await client.person.create({
            data: { name: 'CEO' },
        });

        // Create manager who reports to CEO and is also a mentor
        const manager = await client.person.create({
            data: {
                name: 'Manager',
                manager: { connect: { id: ceo.id } },
            },
        });

        // Create employee who reports to manager and is mentored by CEO
        await expect(
            client.person.create({
                data: {
                    name: 'Employee',
                    manager: { connect: { id: manager.id } },
                    mentor: { connect: { id: ceo.id } },
                },
                include: {
                    manager: true,
                    mentor: true,
                },
            }),
        ).resolves.toMatchObject({
            name: 'Employee',
            manager: { name: 'Manager' },
            mentor: { name: 'CEO' },
        });

        // Check CEO's reports and mentees
        await expect(
            client.person.findUnique({
                where: { id: ceo.id },
                include: {
                    reports: true,
                    mentees: true,
                },
            }),
        ).resolves.toMatchObject({
            name: 'CEO',
            reports: [expect.objectContaining({ name: 'Manager' })],
            mentees: [expect.objectContaining({ name: 'Employee' })],
        });
    });

    it('works with deep self relation queries', async () => {
        client = await createTestClient(
            `
            model Comment {
                id Int @id @default(autoincrement())
                content String
                parent Comment? @relation("CommentThread", fields: [parentId], references: [id])
                replies Comment[] @relation("CommentThread")
                parentId Int?
            }
        `,
            { usePrismaPush: true },
        );

        // Create nested comment thread
        const topComment = await client.comment.create({
            data: {
                content: 'Top level comment',
                replies: {
                    create: [
                        {
                            content: 'First reply',
                            replies: {
                                create: [{ content: 'Nested reply 1' }, { content: 'Nested reply 2' }],
                            },
                        },
                        { content: 'Second reply' },
                    ],
                },
            },
            include: {
                replies: {
                    include: {
                        replies: true,
                    },
                },
            },
        });

        expect(topComment).toMatchObject({
            content: 'Top level comment',
            replies: [
                expect.objectContaining({
                    content: 'First reply',
                    replies: [
                        expect.objectContaining({ content: 'Nested reply 1' }),
                        expect.objectContaining({ content: 'Nested reply 2' }),
                    ],
                }),
                expect.objectContaining({
                    content: 'Second reply',
                    replies: [],
                }),
            ],
        });

        // Query from nested comment up the chain
        const nestedReply = await client.comment.findFirst({
            where: { content: 'Nested reply 1' },
            include: {
                parent: {
                    include: {
                        parent: true,
                    },
                },
            },
        });

        expect(nestedReply).toMatchObject({
            content: 'Nested reply 1',
            parent: expect.objectContaining({
                content: 'First reply',
                parent: expect.objectContaining({
                    content: 'Top level comment',
                }),
            }),
        });
    });
});
