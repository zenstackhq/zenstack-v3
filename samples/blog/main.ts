import { ZenStackClient } from '@zenstackhq/runtime/client';
import { schema } from './zenstack/schema';

async function main() {
    const db = new ZenStackClient(schema, {
        computedFields: {
            User: {
                // provide implementation of the "User.emailDomain" computed field
                emailDomain: (eb) =>
                    // build SQL expression: substr(email, instr(email, '@') + 1)
                    eb.fn('substr', [
                        eb.ref('email'),
                        eb(
                            eb.fn('instr', [eb.ref('email'), eb.val('@')]),
                            '+',
                            1
                        ),
                    ]),
            },
        },
    }).$use({
        id: 'logging',
        beforeQuery(args) {
            console.log('Before query:', args.model, args.operation, args.args);
        },
        afterQuery(args) {
            console.log(
                'After query:',
                args.model,
                args.operation,
                args.result,
                args.error
            );
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
    const userWithEmailDomain = await db.user.findMany({
        where: {
            role: 'USER',
            emailDomain: { endsWith: 'zenstack.dev' },
        },
    });
    console.log('User found with computed field:', userWithEmailDomain);
}

main();
