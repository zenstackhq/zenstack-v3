import { makeClient } from '@zenstackhq/runtime';
import Sqlite from 'better-sqlite3';
import { pushSchema, Schema } from './schema';

async function main() {
    const db = makeClient(Schema, {
        dialectConfig: {
            database: new Sqlite(':memory:'),
        },
    });

    // push schema to DB (this will be handled by migration in the future)
    await pushSchema(db);

    // create with high-level API
    const user1 = await db.user.create({
        data: {
            id: '1',
            email: 'yiming@zenstack.dev',
            posts: {
                create: {
                    title: 'Post1',
                    content: 'An unpublished post',
                    published: false,
                },
            },
        },
        include: { posts: true },
    });
    console.log('User created with high-level API:', user1);

    // create with query-builder API
    const user2 = await db.$qb
        .insertInto('User')
        .values({
            id: '2',
            email: 'jiasheng@zenstack.dev',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        })
        .returningAll()
        .executeTakeFirst();
    console.log('User created with query-builder API', user2);

    // find with high-level API
    const foundPost = await db.post.findFirstOrThrow({
        where: { title: 'Post1' },
        include: { author: true },
    });
    console.log('Post found with high-level API:', foundPost);

    // find with query-builder API
    const foundPost1 = await db.$qb
        .selectFrom('Post')
        .leftJoin('User', 'Post.authorId', 'User.id')
        .select(['Post.id', 'Post.title', 'Post.content', 'User.email'])
        .executeTakeFirst();
    console.log('Post found with query-builder API:', foundPost1);

    // Opt-in to access policy, and access user with different contexts

    const anonDb = db.$withFeatures({ policy: {} });
    const foundUserWithAnon = await anonDb.user.findFirst();
    console.log('User found with anonymous client:', foundUserWithAnon);

    // both the user and posts can be read
    const user1Db = db.$withFeatures({ policy: { auth: { id: '1' } } });
    const foundUserWithUser1 = await user1Db.user.findUnique({
        where: { id: '1' },
        include: { posts: true },
    });
    console.log('User found with user1 client:', foundUserWithUser1);

    // user can be read but posts are filtered
    const user2Db = db.$withFeatures({ policy: { auth: { id: '2' } } });
    const foundUserWithUser2 = await user2Db.user.findUnique({
        where: { id: '1' },
        include: { posts: true },
    });
    console.log('User found with user2 client:', foundUserWithUser2);
}

main();
