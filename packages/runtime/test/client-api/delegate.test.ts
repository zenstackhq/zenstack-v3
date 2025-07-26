import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

const DB_NAME = `client-api-delegate-tests`;

describe.each([{ provider: 'sqlite' as const }, { provider: 'postgresql' as const }])(
    'Delegate model tests for $provider',
    ({ provider }) => {
        const POLYMORPHIC_SCHEMA = `
model User {
    id Int @id @default(autoincrement())
    email String? @unique
    level Int @default(0)
    assets Asset[]
    ratedVideos RatedVideo[] @relation('direct')
}

model Comment {
    id Int @id @default(autoincrement())
    content String
    asset Asset? @relation(fields: [assetId], references: [id])
    assetId Int?
}

model Asset {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    viewCount Int @default(0)
    owner User? @relation(fields: [ownerId], references: [id])
    ownerId Int?
    comments Comment[]
    assetType String
    
    @@delegate(assetType)
}

model Video extends Asset {
    duration Int
    url String @unique
    videoType String

    @@delegate(videoType)
}

model RatedVideo extends Video {
    rating Int
    user User? @relation(name: 'direct', fields: [userId], references: [id])
    userId Int?
}

model Image extends Asset {
    format String
    gallery Gallery? @relation(fields: [galleryId], references: [id])
    galleryId Int?
}

model Gallery {
    id Int @id @default(autoincrement())
    images Image[]
}
`;

        let client: any;

        beforeEach(async () => {
            client = await createTestClient(POLYMORPHIC_SCHEMA, {
                usePrismaPush: true,
                provider,
                dbName: provider === 'postgresql' ? DB_NAME : undefined,
            });
        });

        afterEach(async () => {
            await client.$disconnect();
        });

        describe('Delegate create tests', () => {
            it('works with create', async () => {
                // delegate model cannot be created directly
                await expect(
                    client.video.create({
                        data: {
                            duration: 100,
                            url: 'abc',
                            videoType: 'MyVideo',
                        },
                    }),
                ).rejects.toThrow('is a delegate');
                await expect(
                    client.user.create({
                        data: {
                            assets: {
                                create: { assetType: 'Video' },
                            },
                        },
                    }),
                ).rejects.toThrow('is a delegate');

                // create entity with two levels of delegation
                await expect(
                    client.ratedVideo.create({
                        data: {
                            duration: 100,
                            url: 'abc',
                            rating: 5,
                        },
                    }),
                ).resolves.toMatchObject({
                    id: expect.any(Number),
                    duration: 100,
                    url: 'abc',
                    rating: 5,
                    assetType: 'Video',
                    videoType: 'RatedVideo',
                });

                // create entity with relation
                await expect(
                    client.ratedVideo.create({
                        data: {
                            duration: 50,
                            url: 'bcd',
                            rating: 5,
                            user: { create: { email: 'u1@example.com' } },
                        },
                        include: { user: true },
                    }),
                ).resolves.toMatchObject({
                    userId: expect.any(Number),
                    user: {
                        email: 'u1@example.com',
                    },
                });

                // create entity with one level of delegation
                await expect(
                    client.image.create({
                        data: {
                            format: 'png',
                            gallery: {
                                create: {},
                            },
                        },
                    }),
                ).resolves.toMatchObject({
                    id: expect.any(Number),
                    format: 'png',
                    galleryId: expect.any(Number),
                    assetType: 'Image',
                });
            });

            it('works with createMany', async () => {
                await expect(
                    client.ratedVideo.createMany({
                        data: [
                            { viewCount: 1, duration: 100, url: 'abc', rating: 5 },
                            { viewCount: 2, duration: 200, url: 'def', rating: 4 },
                        ],
                    }),
                ).resolves.toEqual({ count: 2 });

                await expect(client.ratedVideo.findMany()).resolves.toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            viewCount: 1,
                            duration: 100,
                            url: 'abc',
                            rating: 5,
                        }),
                        expect.objectContaining({
                            viewCount: 2,
                            duration: 200,
                            url: 'def',
                            rating: 4,
                        }),
                    ]),
                );

                await expect(
                    client.ratedVideo.createMany({
                        data: [
                            { viewCount: 1, duration: 100, url: 'abc', rating: 5 },
                            { viewCount: 2, duration: 200, url: 'def', rating: 4 },
                        ],
                        skipDuplicates: true,
                    }),
                ).rejects.toThrow('not supported');
            });

            it('works with createManyAndReturn', async () => {
                await expect(
                    client.ratedVideo.createManyAndReturn({
                        data: [
                            { viewCount: 1, duration: 100, url: 'abc', rating: 5 },
                            { viewCount: 2, duration: 200, url: 'def', rating: 4 },
                        ],
                    }),
                ).resolves.toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            viewCount: 1,
                            duration: 100,
                            url: 'abc',
                            rating: 5,
                        }),
                        expect.objectContaining({
                            viewCount: 2,
                            duration: 200,
                            url: 'def',
                            rating: 4,
                        }),
                    ]),
                );
            });
        });

        it('works with find', async () => {
            const u = await client.user.create({
                data: {
                    email: 'u1@example.com',
                },
            });
            const v = await client.ratedVideo.create({
                data: {
                    duration: 100,
                    url: 'abc',
                    rating: 5,
                    owner: { connect: { id: u.id } },
                    user: { connect: { id: u.id } },
                },
            });

            const ratedVideoContent = {
                id: v.id,
                createdAt: expect.any(Date),
                duration: 100,
                rating: 5,
                assetType: 'Video',
                videoType: 'RatedVideo',
            };

            // include all base fields
            await expect(
                client.ratedVideo.findUnique({
                    where: { id: v.id },
                    include: { user: true, owner: true },
                }),
            ).resolves.toMatchObject({ ...ratedVideoContent, user: expect.any(Object), owner: expect.any(Object) });

            // select fields
            await expect(
                client.ratedVideo.findUnique({
                    where: { id: v.id },
                    select: {
                        id: true,
                        viewCount: true,
                        url: true,
                        rating: true,
                    },
                }),
            ).resolves.toEqual({
                id: v.id,
                viewCount: 0,
                url: 'abc',
                rating: 5,
            });

            // omit fields
            const r = await client.ratedVideo.findUnique({
                where: { id: v.id },
                omit: {
                    viewCount: true,
                    url: true,
                    rating: true,
                },
            });
            expect(r.viewCount).toBeUndefined();
            expect(r.url).toBeUndefined();
            expect(r.rating).toBeUndefined();
            expect(r.duration).toEqual(expect.any(Number));

            // include all sub fields
            await expect(
                client.video.findUnique({
                    where: { id: v.id },
                }),
            ).resolves.toMatchObject(ratedVideoContent);

            // include all sub fields
            await expect(
                client.asset.findUnique({
                    where: { id: v.id },
                }),
            ).resolves.toMatchObject(ratedVideoContent);

            // find as a relation
            await expect(
                client.user.findUnique({
                    where: { id: u.id },
                    include: { assets: true, ratedVideos: true },
                }),
            ).resolves.toMatchObject({
                assets: [ratedVideoContent],
                ratedVideos: [ratedVideoContent],
            });

            // find as a relation with selection
            await expect(
                client.user.findUnique({
                    where: { id: u.id },
                    include: {
                        assets: {
                            select: { id: true, assetType: true },
                        },
                        ratedVideos: {
                            url: true,
                            rating: true,
                        },
                    },
                }),
            ).resolves.toMatchObject({
                assets: [{ id: v.id, assetType: 'Video' }],
                ratedVideos: [{ url: 'abc', rating: 5 }],
            });
        });

        describe('Delegate filter tests', async () => {
            beforeEach(async () => {
                const u = await client.user.create({
                    data: {
                        email: 'u1@example.com',
                    },
                });
                await client.ratedVideo.create({
                    data: {
                        viewCount: 0,
                        duration: 100,
                        url: 'v1',
                        rating: 5,
                        owner: { connect: { id: u.id } },
                        user: { connect: { id: u.id } },
                        comments: { create: { content: 'c1' } },
                    },
                });
                await client.ratedVideo.create({
                    data: {
                        viewCount: 1,
                        duration: 200,
                        url: 'v2',
                        rating: 4,
                        owner: { connect: { id: u.id } },
                        user: { connect: { id: u.id } },
                        comments: { create: { content: 'c2' } },
                    },
                });
            });

            it('works with toplevel filters', async () => {
                await expect(
                    client.asset.findMany({
                        where: { viewCount: { gt: 0 } },
                    }),
                ).toResolveWithLength(1);

                await expect(
                    client.video.findMany({
                        where: { viewCount: { gt: 0 }, url: 'v1' },
                    }),
                ).toResolveWithLength(0);

                await expect(
                    client.video.findMany({
                        where: { viewCount: { gt: 0 }, url: 'v2' },
                    }),
                ).toResolveWithLength(1);

                await expect(
                    client.ratedVideo.findMany({
                        where: { viewCount: { gt: 0 }, rating: 5 },
                    }),
                ).toResolveWithLength(0);

                await expect(
                    client.ratedVideo.findMany({
                        where: { viewCount: { gt: 0 }, rating: 4 },
                    }),
                ).toResolveWithLength(1);
            });

            it('works with filtering relations', async () => {
                await expect(
                    client.user.findFirst({
                        include: {
                            assets: {
                                where: { viewCount: { gt: 0 } },
                            },
                        },
                    }),
                ).resolves.toSatisfy((user) => user.assets.length === 1);

                await expect(
                    client.user.findFirst({
                        include: {
                            ratedVideos: {
                                where: { viewCount: { gt: 0 }, url: 'v1' },
                            },
                        },
                    }),
                ).resolves.toSatisfy((user) => user.ratedVideos.length === 0);

                await expect(
                    client.user.findFirst({
                        include: {
                            ratedVideos: {
                                where: { viewCount: { gt: 0 }, url: 'v2' },
                            },
                        },
                    }),
                ).resolves.toSatisfy((user) => user.ratedVideos.length === 1);

                await expect(
                    client.user.findFirst({
                        include: {
                            ratedVideos: {
                                where: { viewCount: { gt: 0 }, rating: 5 },
                            },
                        },
                    }),
                ).resolves.toSatisfy((user) => user.ratedVideos.length === 0);

                await expect(
                    client.user.findFirst({
                        include: {
                            ratedVideos: {
                                where: { viewCount: { gt: 0 }, rating: 4 },
                            },
                        },
                    }),
                ).resolves.toSatisfy((user) => user.ratedVideos.length === 1);
            });

            it('works with filtering parents', async () => {
                await expect(
                    client.user.findFirst({
                        where: {
                            assets: {
                                some: { viewCount: { gt: 0 } },
                            },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.user.findFirst({
                        where: {
                            assets: {
                                some: { viewCount: { gt: 1 } },
                            },
                        },
                    }),
                ).toResolveFalsy();

                await expect(
                    client.user.findFirst({
                        where: {
                            ratedVideos: {
                                some: { viewCount: { gt: 0 }, url: 'v1' },
                            },
                        },
                    }),
                ).toResolveFalsy();

                await expect(
                    client.user.findFirst({
                        where: {
                            ratedVideos: {
                                some: { viewCount: { gt: 0 }, url: 'v2' },
                            },
                        },
                    }),
                ).toResolveTruthy();
            });

            it('works with filtering with relations from base', async () => {
                await expect(
                    client.video.findFirst({
                        where: {
                            owner: {
                                email: 'u1@example.com',
                            },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.video.findFirst({
                        where: {
                            owner: {
                                email: 'u2@example.com',
                            },
                        },
                    }),
                ).toResolveFalsy();

                await expect(
                    client.video.findFirst({
                        where: {
                            owner: null,
                        },
                    }),
                ).toResolveFalsy();

                await expect(
                    client.video.findFirst({
                        where: {
                            owner: { is: null },
                        },
                    }),
                ).toResolveFalsy();

                await expect(
                    client.video.findFirst({
                        where: {
                            owner: { isNot: null },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.video.findFirst({
                        where: {
                            comments: {
                                some: { content: 'c1' },
                            },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.video.findFirst({
                        where: {
                            comments: {
                                all: { content: 'c2' },
                            },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.video.findFirst({
                        where: {
                            comments: {
                                none: { content: 'c1' },
                            },
                        },
                    }),
                ).toResolveTruthy();

                await expect(
                    client.video.findFirst({
                        where: {
                            comments: {
                                none: { content: { startsWith: 'c' } },
                            },
                        },
                    }),
                ).toResolveFalsy();
            });
        });

        describe('Delegate update tests', async () => {
            beforeEach(async () => {
                const u = await client.user.create({
                    data: {
                        id: 1,
                        email: 'u1@example.com',
                    },
                });
                await client.ratedVideo.create({
                    data: {
                        id: 1,
                        viewCount: 0,
                        duration: 100,
                        url: 'v1',
                        rating: 5,
                        owner: { connect: { id: u.id } },
                        user: { connect: { id: u.id } },
                    },
                });
            });

            it('works with toplevel update', async () => {
                // id filter
                await expect(
                    client.ratedVideo.update({
                        where: { id: 1 },
                        data: { viewCount: { increment: 1 }, duration: 200, rating: { set: 4 } },
                    }),
                ).resolves.toMatchObject({
                    viewCount: 1,
                    duration: 200,
                    rating: 4,
                });
                await expect(
                    client.video.update({
                        where: { id: 1 },
                        data: { viewCount: { decrement: 1 }, duration: 100 },
                    }),
                ).resolves.toMatchObject({
                    viewCount: 0,
                    duration: 100,
                });
                await expect(
                    client.asset.update({
                        where: { id: 1 },
                        data: { viewCount: { increment: 1 } },
                    }),
                ).resolves.toMatchObject({
                    viewCount: 1,
                });

                // unique field filter
                await expect(
                    client.ratedVideo.update({
                        where: { url: 'v1' },
                        data: { viewCount: 2, duration: 300, rating: 3 },
                    }),
                ).resolves.toMatchObject({
                    viewCount: 2,
                    duration: 300,
                    rating: 3,
                });
                await expect(
                    client.video.update({
                        where: { url: 'v1' },
                        data: { viewCount: 3 },
                    }),
                ).resolves.toMatchObject({
                    viewCount: 3,
                });

                // not found
                await expect(
                    client.ratedVideo.update({
                        where: { url: 'v2' },
                        data: { viewCount: 4 },
                    }),
                ).toBeRejectedNotFound();

                // update id
                await expect(
                    client.ratedVideo.update({
                        where: { id: 1 },
                        data: { id: 2 },
                    }),
                ).resolves.toMatchObject({
                    id: 2,
                    viewCount: 3,
                });
            });

            it('works with nested update', async () => {
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            assets: {
                                update: {
                                    where: { id: 1 },
                                    data: { viewCount: { increment: 1 } },
                                },
                            },
                        },
                        include: { assets: true },
                    }),
                ).resolves.toMatchObject({
                    assets: [{ viewCount: 1 }],
                });

                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            ratedVideos: {
                                update: {
                                    where: { id: 1 },
                                    data: { viewCount: 2, rating: 4, duration: 200 },
                                },
                            },
                        },
                        include: { ratedVideos: true },
                    }),
                ).resolves.toMatchObject({
                    ratedVideos: [{ viewCount: 2, rating: 4, duration: 200 }],
                });

                // unique filter
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            ratedVideos: {
                                update: {
                                    where: { url: 'v1' },
                                    data: { viewCount: 3 },
                                },
                            },
                        },
                        include: { ratedVideos: true },
                    }),
                ).resolves.toMatchObject({
                    ratedVideos: [{ viewCount: 3 }],
                });

                // deep nested
                await expect(
                    client.user.update({
                        where: { id: 1 },
                        data: {
                            assets: {
                                update: {
                                    where: { id: 1 },
                                    data: { comments: { create: { content: 'c1' } } },
                                },
                            },
                        },
                        include: { assets: { include: { comments: true } } },
                    }),
                ).resolves.toMatchObject({
                    assets: [{ comments: [{ content: 'c1' }] }],
                });
            });

            it('works with updating a base relation', async () => {
                await expect(
                    client.video.update({
                        where: { id: 1 },
                        data: {
                            owner: { update: { level: { increment: 1 } } },
                        },
                        include: { owner: true },
                    }),
                ).resolves.toMatchObject({
                    owner: { level: 1 },
                });
            });

            it('works with updateMany', async () => {
                await client.ratedVideo.create({
                    data: { id: 2, viewCount: 1, duration: 200, url: 'abc', rating: 5 },
                });

                // update from sub model
                await expect(
                    client.ratedVideo.updateMany({
                        where: { duration: { gt: 100 } },
                        data: { viewCount: { increment: 1 }, duration: { increment: 1 }, rating: { set: 3 } },
                    }),
                ).resolves.toEqual({ count: 1 });

                await expect(client.ratedVideo.findMany()).resolves.toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            viewCount: 2,
                            duration: 201,
                            rating: 3,
                        }),
                    ]),
                );

                await expect(
                    client.ratedVideo.updateMany({
                        where: { viewCount: { gt: 1 } },
                        data: { viewCount: { increment: 1 } },
                    }),
                ).resolves.toEqual({ count: 1 });

                await expect(
                    client.ratedVideo.updateMany({
                        where: { rating: 3 },
                        data: { viewCount: { increment: 1 } },
                    }),
                ).resolves.toEqual({ count: 1 });

                // update from delegate model
                await expect(
                    client.asset.updateMany({
                        where: { viewCount: { gt: 0 } },
                        data: { viewCount: 100 },
                    }),
                ).resolves.toEqual({ count: 1 });
                await expect(
                    client.video.updateMany({
                        where: { duration: { gt: 200 } },
                        data: { viewCount: 200, duration: 300 },
                    }),
                ).resolves.toEqual({ count: 1 });
                await expect(client.ratedVideo.findMany()).resolves.toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            viewCount: 200,
                            duration: 300,
                        }),
                    ]),
                );
            });

            it('works with updateManyAndReturn', async () => {
                await client.ratedVideo.create({
                    data: { id: 2, viewCount: 1, duration: 200, url: 'abc', rating: 5 },
                });

                // update from sub model
                await expect(
                    client.ratedVideo.updateManyAndReturn({
                        where: { duration: { gt: 100 } },
                        data: { viewCount: { increment: 1 }, duration: { increment: 1 }, rating: { set: 3 } },
                    }),
                ).resolves.toEqual([
                    expect.objectContaining({
                        viewCount: 2,
                        duration: 201,
                        rating: 3,
                    }),
                ]);

                // update from delegate model
                await expect(
                    client.asset.updateManyAndReturn({
                        where: { viewCount: { gt: 0 } },
                        data: { viewCount: 100 },
                    }),
                ).resolves.toEqual([
                    expect.objectContaining({
                        viewCount: 100,
                        duration: 201,
                        rating: 3,
                    }),
                ]);
            });

            it('works with upsert', async () => {
                await expect(
                    client.asset.upsert({
                        where: { id: 2 },
                        create: {
                            viewCount: 10,
                            assetType: 'Video',
                        },
                        update: {
                            viewCount: { increment: 1 },
                        },
                    }),
                ).rejects.toThrow('is a delegate');

                // create case
                await expect(
                    client.ratedVideo.upsert({
                        where: { id: 2 },
                        create: {
                            id: 2,
                            viewCount: 2,
                            duration: 200,
                            url: 'v2',
                            rating: 3,
                        },
                        update: {
                            viewCount: { increment: 1 },
                        },
                    }),
                ).resolves.toMatchObject({
                    id: 2,
                    viewCount: 2,
                });

                // update case
                await expect(
                    client.ratedVideo.upsert({
                        where: { id: 2 },
                        create: {
                            id: 2,
                            viewCount: 2,
                            duration: 200,
                            url: 'v2',
                            rating: 3,
                        },
                        update: {
                            viewCount: 3,
                            duration: 300,
                            rating: 2,
                        },
                    }),
                ).resolves.toMatchObject({
                    id: 2,
                    viewCount: 3,
                    duration: 300,
                    rating: 2,
                });
            });
        });
    },
);
