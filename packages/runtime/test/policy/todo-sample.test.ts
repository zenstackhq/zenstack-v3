import { generateTsSchemaFromFile } from '@zenstackhq/testtools';
import { beforeAll, describe, expect, it } from 'vitest';
import { ZenStackClient } from '../../src';
import type { SchemaDef } from '../../src/schema';
import { PolicyPlugin } from '../../src/plugins/policy';
import path from 'node:path';

describe('Todo sample', () => {
    let schema: SchemaDef;

    beforeAll(async () => {
        schema = await generateTsSchemaFromFile(
            path.join(__dirname, '../schemas/todo.zmodel')
        );
    });

    it('works with user CRUD', async () => {
        const user1 = {
            id: 'user1',
            email: 'user1@zenstack.dev',
            name: 'User 1',
        };
        const user2 = {
            id: 'user2',
            email: 'user2@zenstack.dev',
            name: 'User 2',
        };

        const client: any = new ZenStackClient(schema);
        await client.$pushSchema();

        const anonDb: any = client.$use(new PolicyPlugin());

        const user1Db = anonDb.$setAuth({ id: user1.id });
        const user2Db = anonDb.$setAuth({ id: user2.id });

        // create user1
        // create should succeed but result can't be read back anonymously
        await expect(anonDb.user.create({ data: user1 })).toBeRejectedByPolicy([
            'result is not allowed to be read back',
        ]);
        await expect(
            user1Db.user.findUnique({ where: { id: user1.id } })
        ).toResolveTruthy();
        await expect(
            user2Db.user.findUnique({ where: { id: user1.id } })
        ).toResolveNull();

        // create user2
        await expect(
            anonDb.user.create({ data: user2 })
        ).toBeRejectedByPolicy();
        await expect(client.user.count()).resolves.toBe(2);

        // find with user1 should only get user1
        const r = await user1Db.user.findMany();
        expect(r).toHaveLength(1);
        expect(r[0]).toEqual(expect.objectContaining(user1));

        // get user2 as user1
        await expect(
            user1Db.user.findUnique({ where: { id: user2.id } })
        ).toResolveNull();

        await expect(
            user1Db.space.create({
                data: {
                    id: 'space1',
                    name: 'Space 1',
                    slug: 'space1',
                    owner: { connect: { id: user1.id } },
                    members: {
                        create: {
                            user: { connect: { id: user1.id } },
                            role: 'ADMIN',
                        },
                    },
                },
            })
        ).toResolveTruthy();

        // user2 can't add himself into space1 by setting himself as admin
        // because "create" check is done before entity is created
        await expect(
            user2Db.spaceUser.create({
                data: {
                    spaceId: 'space1',
                    userId: user2.id,
                    role: 'ADMIN',
                },
            })
        ).toBeRejectedByPolicy();

        // user1 can add user2 as a member
        await expect(
            user1Db.spaceUser.create({
                data: { spaceId: 'space1', userId: user2.id, role: 'USER' },
            })
        ).toResolveTruthy();

        // now both user1 and user2 should be visible
        await expect(user1Db.user.findMany()).resolves.toHaveLength(2);
        await expect(user2Db.user.findMany()).resolves.toHaveLength(2);

        // update user2 as user1
        await expect(
            user2Db.user.update({
                where: { id: user1.id },
                data: { name: 'hello' },
            })
        ).toBeRejectedNotFound();

        // update user1 as user1
        await expect(
            user1Db.user.update({
                where: { id: user1.id },
                data: { name: 'hello' },
            })
        ).toResolveTruthy();

        // delete user2 as user1
        await expect(
            user1Db.user.delete({ where: { id: user2.id } })
        ).toBeRejectedNotFound();

        // delete user1 as user1
        await expect(
            user1Db.user.delete({ where: { id: user1.id } })
        ).toResolveTruthy();
        await expect(
            user1Db.user.findUnique({ where: { id: user1.id } })
        ).toResolveNull();
    });
});
