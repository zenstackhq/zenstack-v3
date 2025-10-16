import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2028', () => {
    it('verifies issue 2028', async () => {
        const db = await createTestClient(
            `
    enum FooType {
        Bar
        Baz
    }

    model User {
        id          String       @id @default(cuid())
        userFolders UserFolder[]
        @@allow('all', true)
    }

    model Foo {
        id          String       @id @default(cuid())
        type        FooType

        userFolders UserFolder[]

        @@delegate(type)
        @@allow('all', true)
    }

    model Bar extends Foo {
        name String
    }

    model Baz extends Foo {
        age Int
    }

    model UserFolder {
        id     String @id @default(cuid())
        userId String
        fooId  String

        user   User   @relation(fields: [userId], references: [id])
        foo    Foo    @relation(fields: [fooId], references: [id])

        @@unique([userId, fooId])
        @@allow('all', true)
    }
                `,
        );

        // Ensure we can query by the CompoundUniqueInput
        const user = await db.user.create({ data: {} });
        const bar = await db.bar.create({ data: { name: 'bar' } });
        const baz = await db.baz.create({ data: { age: 1 } });

        const userFolderA = await db.userFolder.create({
            data: {
                userId: user.id,
                fooId: bar.id,
            },
        });

        const userFolderB = await db.userFolder.create({
            data: {
                userId: user.id,
                fooId: baz.id,
            },
        });

        await expect(
            db.userFolder.findUnique({
                where: {
                    userId_fooId: {
                        userId: user.id,
                        fooId: bar.id,
                    },
                },
            }),
        ).resolves.toMatchObject(userFolderA);

        await expect(
            db.userFolder.findUnique({
                where: {
                    userId_fooId: {
                        userId: user.id,
                        fooId: baz.id,
                    },
                },
            }),
        ).resolves.toMatchObject(userFolderB);
    });
});
