import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '../utils';

describe('View Policy Test', () => {
    it('view policy', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id    Int     @id @default(autoincrement())
                email String  @unique
                name  String?
                posts Post[]
                userInfo UserInfo?
            }
              
            model Post {
                id        Int     @id @default(autoincrement())
                title     String
                content   String?
                published Boolean @default(false)
                author    User?   @relation(fields: [authorId], references: [id])
                authorId  Int?
            }
              
            view UserInfo {
                id Int    @unique
                name String
                email String
                postCount Int
                user      User   @relation(fields: [id], references: [id])

                @@allow('read', postCount > 1)
            }
            `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.$executeRaw`CREATE VIEW UserInfo as select user.id, user.name, user.email, user.id as userId, count(post.id) as postCount from user left join post on user.id = post.authorId group by user.id;`;

        await rawDb.user.create({
            data: {
                email: 'alice@prisma.io',
                name: 'Alice',
                posts: {
                    create: {
                        title: 'Check out Prisma with Next.js',
                        content: 'https://www.prisma.io/nextjs',
                        published: true,
                    },
                },
            },
        });
        await rawDb.user.create({
            data: {
                email: 'bob@prisma.io',
                name: 'Bob',
                posts: {
                    create: [
                        {
                            title: 'Follow Prisma on Twitter',
                            content: 'https://twitter.com/prisma',
                            published: true,
                        },
                        {
                            title: 'Follow Nexus on Twitter',
                            content: 'https://twitter.com/nexusgql',
                            published: false,
                        },
                    ],
                },
            },
        });

        await expect(rawDb.userInfo.findMany()).resolves.toHaveLength(2);
        await expect(db.userInfo.findMany()).resolves.toHaveLength(1);

        const r1 = await rawDb.userInfo.findFirst({ include: { user: true } });
        expect(r1.user).toBeTruthy();

        // user not readable
        await expect(db.userInfo.findFirst({ include: { user: true } })).resolves.toMatchObject({ user: null });
    });
});
