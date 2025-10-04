import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, describe, expect, it } from 'vitest';

const TEST_DB = 'client-api-relation-test-one-to-one';

describe.each([{ provider: 'sqlite' as const }, { provider: 'postgresql' as const }])(
    'One-to-one relation tests',
    ({ provider }) => {
        let client: any;

        afterEach(async () => {
            await client?.$disconnect();
        });

        it('works with unnamed one-to-one relation', async () => {
            client = await createTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                name String
                profile Profile?
            }

            model Profile {
                id Int @id @default(autoincrement())
                age Int
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
            }
        `,
                {
                    provider,
                    dbName: TEST_DB,
                },
            );

            await expect(
                client.user.create({
                    data: {
                        name: 'User',
                        profile: { create: { age: 20 } },
                    },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                name: 'User',
                profile: { age: 20 },
            });
        });

        it('works with named one-to-one relation', async () => {
            client = await createTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                name String
                profile1 Profile? @relation('profile1')
                profile2 Profile? @relation('profile2')
            }

            model Profile {
                id Int @id @default(autoincrement())
                age Int
                user1 User? @relation('profile1', fields: [userId1], references: [id])
                user2 User? @relation('profile2', fields: [userId2], references: [id])
                userId1 Int? @unique
                userId2 Int? @unique
            }
        `,
                {
                    provider,
                    dbName: TEST_DB,
                },
            );

            await expect(
                client.user.create({
                    data: {
                        name: 'User',
                        profile1: { create: { age: 20 } },
                        profile2: { create: { age: 21 } },
                    },
                    include: { profile1: true, profile2: true },
                }),
            ).resolves.toMatchObject({
                name: 'User',
                profile1: { age: 20 },
                profile2: { age: 21 },
            });
        });
    },
);
