import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Abstract models', () => {
    it('connect test1', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
            profile Profile? @relation(fields: [profileId], references: [id])
            profileId Int? @unique

            @@allow('create,read', true)
            @@allow('update', auth().id == 1)
        }
        
        type BaseProfile {
            id Int @id @default(autoincrement())

            @@allow('all', true)
        }

        model Profile with BaseProfile {
            name String
            user User?
        }
        `,
        );

        const dbUser2 = db.$setAuth({ id: 2 });
        const user = await dbUser2.user.create({ data: { id: 1 } });
        const profile = await dbUser2.profile.create({ data: { id: 1, name: 'John' } });
        await expect(
            dbUser2.profile.update({ where: { id: 1 }, data: { user: { connect: { id: user.id } } } }),
        ).toBeRejectedNotFound();
        await expect(
            dbUser2.user.update({ where: { id: 1 }, data: { profile: { connect: { id: profile.id } } } }),
        ).toBeRejectedNotFound();

        const dbUser1 = db.$setAuth({ id: 1 });
        await expect(
            dbUser1.profile.update({ where: { id: 1 }, data: { user: { connect: { id: user.id } } } }),
        ).toResolveTruthy();
        await expect(
            dbUser1.user.update({ where: { id: 1 }, data: { profile: { connect: { id: profile.id } } } }),
        ).toResolveTruthy();
    });

    it('connect test2', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
            profile Profile?

            @@allow('all', true)
        }
        
        type BaseProfile {
            id Int @id @default(autoincrement())

            @@allow('create,read', true)
            @@allow('update', auth().id == 1)
        }

        model Profile with BaseProfile {
            name String
            user User? @relation(fields: [userId], references: [id])
            userId Int? @unique
        }
        `,
        );

        const dbUser2 = db.$setAuth({ id: 2 });
        const user = await dbUser2.user.create({ data: { id: 1 } });
        const profile = await dbUser2.profile.create({ data: { id: 1, name: 'John' } });
        await expect(
            dbUser2.profile.update({ where: { id: 1 }, data: { user: { connect: { id: user.id } } } }),
        ).toBeRejectedNotFound();
        await expect(
            dbUser2.user.update({ where: { id: 1 }, data: { profile: { connect: { id: profile.id } } } }),
        ).toBeRejectedNotFound();

        const dbUser1 = db.$setAuth({ id: 1 });
        await expect(
            dbUser1.profile.update({ where: { id: 1 }, data: { user: { connect: { id: user.id } } } }),
        ).toResolveTruthy();
        await expect(
            dbUser1.user.update({ where: { id: 1 }, data: { profile: { connect: { id: profile.id } } } }),
        ).toResolveTruthy();
    });
});
