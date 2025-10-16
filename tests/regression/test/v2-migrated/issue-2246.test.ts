import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2246', () => {
    it('verifies issue 2246', async () => {
        const db = await createTestClient(
            `
    model Media {
      id Int @id @default(autoincrement())
      title String
      mediaType String
  
      @@delegate(mediaType)
      @@allow('all', true)
    }

    model Movie extends Media {
      director Director @relation(fields: [directorId], references: [id])
      directorId Int
      duration Int
      rating String
    }

    model Director {
      id Int @id @default(autoincrement())
      name String
      email String
      movies Movie[]
  
      @@allow('all', true)
    }
                `,
        );

        await db.director.create({
            data: {
                name: 'Christopher Nolan',
                email: 'christopher.nolan@example.com',
                movies: {
                    create: {
                        title: 'Inception',
                        duration: 148,
                        rating: 'PG-13',
                    },
                },
            },
        });

        await expect(
            db.director.findMany({
                include: {
                    movies: {
                        where: { title: 'Inception' },
                    },
                },
            }),
        ).resolves.toHaveLength(1);

        await expect(
            db.director.findFirst({
                include: {
                    _count: { select: { movies: { where: { title: 'Inception' } } } },
                },
            }),
        ).resolves.toMatchObject({ _count: { movies: 1 } });

        await expect(
            db.movie.findMany({
                where: { title: 'Interstellar' },
            }),
        ).resolves.toHaveLength(0);

        await expect(
            db.director.findFirst({
                include: {
                    _count: { select: { movies: { where: { title: 'Interstellar' } } } },
                },
            }),
        ).resolves.toMatchObject({ _count: { movies: 0 } });
    });
});
