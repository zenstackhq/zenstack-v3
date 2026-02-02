import { createPolicyTestClient, createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';
import { schema } from './zenstack/schema';

describe('App-lc regression tests', () => {
    it('verifies', async () => {
        const db = await createPolicyTestClient(schema, {
            provider: 'postgresql',
            pushDb: false,
            dbName: 'gentl-v2',
            log: (event) => {
                console.log(
                    `[${event.queryDurationMillis.toFixed(2)}ms]`,
                    event.query.sql,
                    JSON.stringify(event.query.parameters),
                );
            },
        });

        const authDb = db.$setAuth({ id: 'cmkuikf580000kcvhfobn8dk0' });

        console.time('query');

        const call = async () =>
            authDb.instance.findMany({
                where: {
                    OR: [
                        { ownerId: 'cmkuikf580000kcvhfobn8dk0' },
                        {
                            users: {
                                some: { accountId: 'cmkuikf580000kcvhfobn8dk0' },
                            },
                        },
                        {
                            invitations: {
                                some: { email: 'a1@example.com', status: 'PENDING' },
                            },
                        },
                    ],
                },
                orderBy: { createdAt: 'asc' },
                include: {
                    boards: { select: { id: true, name: true } },
                    enumerators: {
                        select: { id: true, name: true, internalName: true },
                    },
                    invitations: {
                        where: { email: 'a1@example.com' },
                        select: {
                            id: true,
                            email: true,
                            status: true,
                            validUntil: true,
                        },
                    },
                },
            });

        await call();
        await call();

        // console.log('Instances:', instance.length);
        console.timeEnd('query');
    });

    it('verifies 2', async () => {
        const db = await createTestClient(
            `
model User {
    id    Int @id
    name  String
    posts     Post[]

    @@allow('read', posts?[published])
}            

model Post {
    id        Int @id
    title     String
    published Boolean
    author    User @relation(fields: [authorId], references: [id])
    authorId  Int

    @@allow('read', check(author))
}
        `,
            { debug: true },
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                name: 'Alice',
                posts: {
                    create: [
                        { id: 1, title: 'First Post', published: true },
                        { id: 2, title: 'Second Post', published: false },
                    ],
                },
            },
        });

        const r = await db.user.findMany({ where: { posts: { some: { title: 'First Post' } } } });
        console.log('Users:', r);
    });
});
