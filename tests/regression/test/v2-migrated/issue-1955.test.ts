import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 1955', () => {
    it('simple policy', async () => {
        const db = await createPolicyTestClient(
            `
            model Post {
                id Int @id @default(autoincrement())
                name String
                expections String[]
                @@allow('all', true)
            }
            `,
            { provider: 'postgresql' },
        );

        await expect(
            db.post.createManyAndReturn({
                data: [
                    {
                        name: 'bla',
                    },
                    {
                        name: 'blu',
                    },
                ],
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'bla' }),
                expect.objectContaining({ name: 'blu' }),
            ]),
        );

        await expect(
            db.post.updateManyAndReturn({
                data: { name: 'foo' },
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'foo' }),
                expect.objectContaining({ name: 'foo' }),
            ]),
        );
    });

    it('complex policy', async () => {
        const db = await createPolicyTestClient(
            `
            model Post {
                id Int @id @default(autoincrement())
                name String
                expections String[]
                comments Comment[]

                @@allow('create', true)
                @@allow('read,update', comments^[private])
            }

            model Comment {
                id Int @id @default(autoincrement())
                private Boolean @default(false)
                postId Int
                post Post @relation(fields: [postId], references: [id])
            }
            `,
            { provider: 'postgresql' },
        );

        await expect(
            db.post.createManyAndReturn({
                data: [
                    {
                        name: 'bla',
                    },
                    {
                        name: 'blu',
                    },
                ],
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'bla' }),
                expect.objectContaining({ name: 'blu' }),
            ]),
        );

        await expect(
            db.post.updateManyAndReturn({
                data: { name: 'foo' },
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'foo' }),
                expect.objectContaining({ name: 'foo' }),
            ]),
        );
    });
});
