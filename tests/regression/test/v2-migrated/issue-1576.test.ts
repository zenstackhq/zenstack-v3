import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1576', () => {
    it('verifies issue 1576', async () => {
        const db = await createTestClient(
            `
    model Profile {
      id Int @id @default(autoincrement())
      name String
      items Item[]
      type String
      @@delegate(type)
      @@allow('all', true)
    }

    model GoldProfile extends Profile {
      ticket Int
    }

    model Item {
      id Int @id @default(autoincrement())
      profileId Int
      profile Profile @relation(fields: [profileId], references: [id])
      type String
      @@delegate(type)
      @@allow('all', true)
    }

    model GoldItem extends Item {
      inventory Boolean
    }
              `,
        );

        const profile = await db.goldProfile.create({
            data: {
                name: 'hello',
                ticket: 5,
            },
        });

        if (db.$schema.provider.type !== 'mysql') {
            await expect(
                db.goldItem.createManyAndReturn({
                    data: [
                        {
                            profileId: profile.id,
                            inventory: true,
                        },
                        {
                            profileId: profile.id,
                            inventory: true,
                        },
                    ],
                }),
            ).resolves.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ profileId: profile.id, type: 'GoldItem', inventory: true }),
                    expect.objectContaining({ profileId: profile.id, type: 'GoldItem', inventory: true }),
                ]),
            );
        } else {
            // mysql doesn't support createManyAndReturn
            await expect(
                db.goldItem.createMany({
                    data: [
                        {
                            profileId: profile.id,
                            inventory: true,
                        },
                        {
                            profileId: profile.id,
                            inventory: true,
                        },
                    ],
                }),
            ).toResolveTruthy();
            await expect(db.goldItem.findMany()).resolves.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ profileId: profile.id, type: 'GoldItem', inventory: true }),
                    expect.objectContaining({ profileId: profile.id, type: 'GoldItem', inventory: true }),
                ]),
            );
        }
    });
});
