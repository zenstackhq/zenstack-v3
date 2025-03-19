import { createClient } from '@zenstackhq/runtime';
import Sqlite from 'better-sqlite3';
import { schema } from './zenstack/schema';

async function main() {
    const db = createClient(schema, {
        dialectConfig: {
            database: new Sqlite('./zenstack/dev.db'),
        },
        log: ['query'],
    });

    await db.post.deleteMany();
    await db.profile.deleteMany();
    await db.user.deleteMany();

    // create with high-level API
    const user1 = await db.user.create({
        data: {
            id: '1',
            email: 'yiming@gmail.com',
            role: 'ADMIN',
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
            role: 'USER',
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

    // find with mixed field filter and kysely expression builder
    const foundUserWithExpressionBuilder = await db.user.findFirst({
        where: {
            role: 'USER',
            $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
        },
    });
    console.log(
        'User found with kysely expression builder:',
        foundUserWithExpressionBuilder
    );

    // find with query-builder API
    const foundPost1 = await db.$qb
        .selectFrom('Post')
        .leftJoin('User', 'Post.authorId', 'User.id')
        .select(['Post.id', 'Post.title', 'Post.content', 'User.email'])
        .executeTakeFirst();
    console.log('Post found with query-builder API:', foundPost1);
}

main();
