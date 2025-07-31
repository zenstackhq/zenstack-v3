import { ZenStackClient } from '@zenstackhq/runtime';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { schema } from './zenstack/schema';

async function main() {
    const db = new ZenStackClient(schema, {
        dialect: new SqliteDialect({ database: new SQLite('./zenstack/dev.db') }),
        computedFields: {
            User: {
                postCount: (eb) =>
                    eb
                        .selectFrom('Post')
                        .whereRef('Post.authorId', '=', 'User.id')
                        .select(({ fn }) => fn.countAll<number>().as('postCount')),
            },
        },
    }).$use({
        id: 'cost-logger',
        onQuery: {
            $allModels: {
                $allOperations: async ({ model, operation, args, query }) => {
                    const start = Date.now();
                    const result = await query(args);
                    console.log(`[cost] ${model} ${operation} took ${Date.now() - start}ms`);
                    return result;
                },
            },
        },
    });

    // clean up existing data
    await db.post.deleteMany();
    await db.profile.deleteMany();
    await db.user.deleteMany();

    // create users and some posts
    const user1 = await db.user.create({
        data: {
            email: 'yiming@gmail.com',
            role: 'ADMIN',
            posts: {
                create: [
                    {
                        title: 'Post1',
                        content: 'An unpublished post',
                        published: false,
                    },
                    {
                        title: 'Post2',
                        content: 'A published post',
                        published: true,
                    },
                ],
            },
        },
        include: { posts: true },
    });
    console.log('User created:', user1);

    const user2 = await db.user.create({
        data: {
            email: 'jiasheng@zenstack.dev',
            role: 'USER',
            posts: {
                create: {
                    title: 'Post3',
                    content: 'Another unpublished post',
                    published: false,
                },
            },
        },
        include: { posts: true },
    });
    console.log('User created:', user2);

    // find with where conditions mixed with low-level Kysely expression builder
    const userWithProperDomain = await db.user.findMany({
        where: {
            role: 'USER',
            $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
        },
    });
    console.log('User found with mixed filter:', userWithProperDomain);

    // filter with computed field
    const userWithMorePosts = await db.user.findMany({
        where: {
            role: 'ADMIN',
            postCount: {
                gt: 1,
            },
        },
    });
    console.log('User found with computed field:', userWithMorePosts);
}

main();
