import { describe, expect, it } from 'vitest';
import { schema } from '../schemas/todo/schema';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('todo sample tests', () => {
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

        const anonDb = await createPolicyTestClient(schema);
        const rawDb = anonDb.$unuseAll();

        const user1Db = anonDb.$setAuth({ id: user1.id });
        const user2Db = anonDb.$setAuth({ id: user2.id });

        // create user1
        // create should succeed but result can't be read back anonymously
        await expect(anonDb.user.create({ data: user1 })).toBeRejectedByPolicy([
            'result is not allowed to be read back',
        ]);
        await expect(user1Db.user.findUnique({ where: { id: user1.id } })).toResolveTruthy();
        await expect(user2Db.user.findUnique({ where: { id: user1.id } })).toResolveNull();

        // create user2
        await expect(anonDb.user.create({ data: user2 })).toBeRejectedByPolicy();
        await expect(rawDb.user.count()).resolves.toBe(2);

        // find with user1 should only get user1
        const r = await user1Db.user.findMany();
        expect(r).toHaveLength(1);
        expect(r[0]).toEqual(expect.objectContaining(user1));

        // get user2 as user1
        await expect(user1Db.user.findUnique({ where: { id: user2.id } })).toResolveNull();

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
            }),
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
            }),
        ).toBeRejectedByPolicy();

        // user1 can add user2 as a member
        await expect(
            user1Db.spaceUser.create({
                data: { spaceId: 'space1', userId: user2.id, role: 'USER' },
            }),
        ).toResolveTruthy();

        // now both user1 and user2 should be visible
        await expect(user1Db.user.findMany()).resolves.toHaveLength(2);
        await expect(user2Db.user.findMany()).resolves.toHaveLength(2);

        // update user2 as user1
        await expect(
            user2Db.user.update({
                where: { id: user1.id },
                data: { name: 'hello' },
            }),
        ).toBeRejectedNotFound();

        // update user1 as user1
        await expect(
            user1Db.user.update({
                where: { id: user1.id },
                data: { name: 'hello' },
            }),
        ).toResolveTruthy();

        // delete user2 as user1
        await expect(user1Db.user.delete({ where: { id: user2.id } })).toBeRejectedNotFound();

        // delete user1 as user1
        await expect(user1Db.user.delete({ where: { id: user1.id } })).toResolveTruthy();
        await expect(user1Db.user.findUnique({ where: { id: user1.id } })).toResolveNull();
    });

    it('works with todo list CRUD', async () => {
        const anonDb = await createPolicyTestClient(schema);
        const rawDb = anonDb.$unuseAll();

        await createSpaceAndUsers(rawDb);

        const emptyUIDDb = anonDb.$setAuth({ id: '' });
        const user1Db = anonDb.$setAuth({ id: user1.id });
        const user2Db = anonDb.$setAuth({ id: user2.id });
        const user3Db = anonDb.$setAuth({ id: user3.id });

        await expect(
            anonDb.list.create({
                data: {
                    id: 'list1',
                    title: 'List 1',
                    owner: { connect: { id: user1.id } },
                    space: { connect: { id: space1.id } },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            user1Db.list.create({
                data: {
                    id: 'list1',
                    title: 'List 1',
                    owner: { connect: { id: user1.id } },
                    space: { connect: { id: space1.id } },
                },
            }),
        ).toResolveTruthy();

        await expect(user1Db.list.findMany()).resolves.toHaveLength(1);
        await expect(anonDb.list.findMany()).resolves.toHaveLength(0);
        await expect(emptyUIDDb.list.findMany()).resolves.toHaveLength(0);
        await expect(anonDb.list.findUnique({ where: { id: 'list1' } })).toResolveNull();

        // accessible to owner
        await expect(user1Db.list.findUnique({ where: { id: 'list1' } })).resolves.toEqual(
            expect.objectContaining({ id: 'list1', title: 'List 1' }),
        );

        // accessible to user in the space
        await expect(user2Db.list.findUnique({ where: { id: 'list1' } })).toResolveTruthy();

        // inaccessible to user not in the space
        await expect(user3Db.list.findUnique({ where: { id: 'list1' } })).toResolveNull();

        // make a private list
        await user1Db.list.create({
            data: {
                id: 'list2',
                title: 'List 2',
                private: true,
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
            },
        });

        // accessible to owner
        await expect(user1Db.list.findUnique({ where: { id: 'list2' } })).toResolveTruthy();

        // inaccessible to other user in the space
        await expect(user2Db.list.findUnique({ where: { id: 'list2' } })).toResolveNull();

        // create a list which doesn't match credential should fail
        await expect(
            user1Db.list.create({
                data: {
                    id: 'list3',
                    title: 'List 3',
                    owner: { connect: { id: user2.id } },
                    space: { connect: { id: space1.id } },
                },
            }),
        ).toBeRejectedByPolicy();

        // create a list which doesn't match credential's space should fail
        await expect(
            user1Db.list.create({
                data: {
                    id: 'list3',
                    title: 'List 3',
                    owner: { connect: { id: user1.id } },
                    space: { connect: { id: space2.id } },
                },
            }),
        ).toBeRejectedByPolicy();

        // update list
        await expect(
            user1Db.list.update({
                where: { id: 'list1' },
                data: {
                    title: 'List 1 updated',
                },
            }),
        ).resolves.toEqual(expect.objectContaining({ title: 'List 1 updated' }));

        await expect(
            user2Db.list.update({
                where: { id: 'list1' },
                data: {
                    title: 'List 1 updated',
                },
            }),
        ).toBeRejectedNotFound();

        // delete list
        await expect(user2Db.list.delete({ where: { id: 'list1' } })).toBeRejectedNotFound();
        await expect(user1Db.list.delete({ where: { id: 'list1' } })).toResolveTruthy();
        await expect(user1Db.list.findUnique({ where: { id: 'list1' } })).toResolveNull();
    });

    it('works with todo CRUD', async () => {
        const anonDb = await createPolicyTestClient(schema);
        await createSpaceAndUsers(anonDb.$unuseAll());

        const user1Db = anonDb.$setAuth({ id: user1.id });
        const user2Db = anonDb.$setAuth({ id: user2.id });

        // create a public list
        await user1Db.list.create({
            data: {
                id: 'list1',
                title: 'List 1',
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
            },
        });

        // create
        await expect(
            user1Db.todo.create({
                data: {
                    id: 'todo1',
                    title: 'Todo 1',
                    owner: { connect: { id: user1.id } },
                    list: {
                        connect: { id: 'list1' },
                    },
                },
            }),
        ).toResolveTruthy();

        await expect(
            user2Db.todo.create({
                data: {
                    id: 'todo2',
                    title: 'Todo 2',
                    owner: { connect: { id: user2.id } },
                    list: {
                        connect: { id: 'list1' },
                    },
                },
            }),
        ).toResolveTruthy();

        // read
        await expect(user1Db.todo.findMany()).resolves.toHaveLength(2);
        await expect(user2Db.todo.findMany()).resolves.toHaveLength(2);

        // update, user in the same space can freely update
        await expect(
            user1Db.todo.update({
                where: { id: 'todo1' },
                data: {
                    title: 'Todo 1 updated',
                },
            }),
        ).toResolveTruthy();
        await expect(
            user1Db.todo.update({
                where: { id: 'todo2' },
                data: {
                    title: 'Todo 2 updated',
                },
            }),
        ).toResolveTruthy();

        // create a private list
        await user1Db.list.create({
            data: {
                id: 'list2',
                private: true,
                title: 'List 2',
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
            },
        });

        // create
        await expect(
            user1Db.todo.create({
                data: {
                    id: 'todo3',
                    title: 'Todo 3',
                    owner: { connect: { id: user1.id } },
                    list: {
                        connect: { id: 'list2' },
                    },
                },
            }),
        ).toResolveTruthy();

        // reject because list2 is private
        await expect(
            user2Db.todo.create({
                data: {
                    id: 'todo4',
                    title: 'Todo 4',
                    owner: { connect: { id: user2.id } },
                    list: {
                        connect: { id: 'list2' },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        // update, only owner can update todo in a private list
        await expect(
            user1Db.todo.update({
                where: { id: 'todo3' },
                data: {
                    title: 'Todo 3 updated',
                },
            }),
        ).toResolveTruthy();
        await expect(
            user2Db.todo.update({
                where: { id: 'todo3' },
                data: {
                    title: 'Todo 3 updated',
                },
            }),
        ).toBeRejectedNotFound();
    });

    it('works with relation queries', async () => {
        const anonDb = await createPolicyTestClient(schema);
        await createSpaceAndUsers(anonDb.$unuseAll());

        const user1Db = anonDb.$setAuth({ id: user1.id });
        const user2Db = anonDb.$setAuth({ id: user2.id });

        await user1Db.list.create({
            data: {
                id: 'list1',
                title: 'List 1',
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
            },
        });

        await user1Db.list.create({
            data: {
                id: 'list2',
                title: 'List 2',
                private: true,
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
            },
        });

        const r = await user1Db.space.findFirst({
            where: { id: 'space1' },
            include: { lists: true },
        });
        expect(r?.lists).toHaveLength(2);

        const r1 = await user2Db.space.findFirst({
            where: { id: 'space1' },
            include: { lists: true },
        });
        expect(r1?.lists).toHaveLength(1);
    });

    it('works with post-update checks', async () => {
        const anonDb = await createPolicyTestClient(schema);
        await createSpaceAndUsers(anonDb.$unuseAll());

        const user1Db = anonDb.$setAuth({ id: user1.id });

        await user1Db.list.create({
            data: {
                id: 'list1',
                title: 'List 1',
                owner: { connect: { id: user1.id } },
                space: { connect: { id: space1.id } },
                todos: {
                    create: {
                        id: 'todo1',
                        title: 'Todo 1',
                        owner: { connect: { id: user1.id } },
                    },
                },
            },
        });

        // change list's owner
        await expect(
            user1Db.list.update({
                where: { id: 'list1' },
                data: {
                    owner: { connect: { id: user2.id } },
                },
            }),
        ).toBeRejectedByPolicy();

        // change todo's owner
        await expect(
            user1Db.todo.update({
                where: { id: 'todo1' },
                data: {
                    owner: { connect: { id: user2.id } },
                },
            }),
        ).toBeRejectedByPolicy();

        // nested change todo's owner
        await expect(
            user1Db.list.update({
                where: { id: 'list1' },
                data: {
                    todos: {
                        update: {
                            where: { id: 'todo1' },
                            data: {
                                owner: { connect: { id: user2.id } },
                            },
                        },
                    },
                },
            }),
        ).toBeRejectedByPolicy();
    });
});

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

const user3 = {
    id: 'user3',
    email: 'user3@zenstack.dev',
    name: 'User 3',
};

const space1 = {
    id: 'space1',
    name: 'Space 1',
    slug: 'space1',
};

const space2 = {
    id: 'space2',
    name: 'Space 2',
    slug: 'space2',
};

async function createSpaceAndUsers(db: any) {
    // create users
    await db.user.create({ data: user1 });
    await db.user.create({ data: user2 });
    await db.user.create({ data: user3 });

    // add user1 and user2 into space1
    await db.space.create({
        data: {
            ...space1,
            members: {
                create: [
                    {
                        user: { connect: { id: user1.id } },
                        role: 'ADMIN',
                    },
                    {
                        user: { connect: { id: user2.id } },
                        role: 'USER',
                    },
                ],
            },
        },
    });

    // add user3 to space2
    await db.space.create({
        data: {
            ...space2,
            members: {
                create: [
                    {
                        user: { connect: { id: user3.id } },
                        role: 'ADMIN',
                    },
                ],
            },
        },
    });
}
