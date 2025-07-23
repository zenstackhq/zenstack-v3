import { describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

describe('Delegate model tests', () => {
    const POLYMORPHIC_SCHEMA = `
model User {
    id Int @id @default(autoincrement())
    email String? @unique
    level Int @default(0)
    assets Asset[]
    ratedVideos RatedVideo[] @relation('direct')
}

model Asset {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    viewCount Int @default(0)
    owner User? @relation(fields: [ownerId], references: [id])
    ownerId Int?
    assetType String
    
    @@delegate(assetType)
}

model Video extends Asset {
    duration Int
    url String
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

    it('works with create', async () => {
        const client = await createTestClient(POLYMORPHIC_SCHEMA, {
            usePrismaPush: true,
        });

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

    it('works with find', async () => {
        const client = await createTestClient(POLYMORPHIC_SCHEMA, {
            usePrismaPush: true,
            log: ['query'],
        });

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
                user: { connect: { id: u.id } },
            },
            include: { user: true },
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
                include: { user: true },
            }),
        ).resolves.toMatchObject({ ...ratedVideoContent, user: expect.any(Object) });

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
    });
});
