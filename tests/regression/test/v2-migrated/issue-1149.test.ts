import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1149', () => {
    it('verifies issue 1149', async () => {
        const schema = `
        model User {
          id String @id @default(cuid())
          name String

          userRankings UserRanking[]
          userFavorites UserFavorite[]
        }

        model Entity {
          id String @id @default(cuid())
          name String
          type String
          userRankings UserRanking[]
          userFavorites UserFavorite[]

          @@delegate(type)
        }

        model Person extends Entity {
        }

        model Studio extends Entity {
        }


        model UserRanking {
          id String @id @default(cuid())
          rank Int

          entityId String
          entity Entity @relation(fields: [entityId], references: [id], onUpdate: NoAction)
          userId String
          user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)
        }

        model UserFavorite {
          id String @id @default(cuid())

          entityId String
          entity Entity @relation(fields: [entityId], references: [id], onUpdate: NoAction)
          userId String
          user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)
        }
        `;

        const db = await createTestClient(schema);

        const user = await db.user.create({ data: { name: 'user' } });
        const person = await db.person.create({ data: { name: 'person' } });

        await expect(
            db.userRanking.createMany({
                data: {
                    rank: 1,
                    entityId: person.id,
                    userId: user.id,
                },
            }),
        ).resolves.toMatchObject({ count: 1 });

        await expect(
            db.userRanking.createMany({
                data: [
                    {
                        rank: 2,
                        entityId: person.id,
                        userId: user.id,
                    },
                    {
                        rank: 3,
                        entityId: person.id,
                        userId: user.id,
                    },
                ],
            }),
        ).resolves.toMatchObject({ count: 2 });

        await expect(db.userRanking.findMany()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rank: 1 }),
                expect.objectContaining({ rank: 2 }),
                expect.objectContaining({ rank: 3 }),
            ]),
        );
    });
});
