import { createTestProject, generateTsSchemaInPlace } from '@zenstackhq/testtools';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestClient } from '@zenstackhq/testtools';

describe('Import tests', () => {
    it('works with imported models', async () => {
        const workDir = createTestProject();

        fs.writeFileSync(
            path.join(workDir, 'user.zmodel'),
            `
        import './post'
        model User {
            id Int @id @default(autoincrement())
            email String
            posts Post[]
        }
          `,
        );
        fs.writeFileSync(
            path.join(workDir, 'post.zmodel'),
            `
        import './user'

        model Post {
            id Int @id @default(autoincrement())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId Int
        }
        `,
        );
        fs.writeFileSync(
            path.join(workDir, 'main.zmodel'),
            `
            import './user'
            import './post'

            datasource db {
                provider = "sqlite"
                url      = "file:./dev.db"
            }
            `,
        );

        const { schema } = await generateTsSchemaInPlace(path.join(workDir, 'main.zmodel'));
        const client: any = await createTestClient(schema);

        await expect(
            client.user.create({
                data: {
                    id: 1,
                    email: 'u1@test.com',
                    posts: {
                        create: { title: 'Post1' },
                    },
                },
                include: { posts: true },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            posts: [
                expect.objectContaining({
                    title: 'Post1',
                }),
            ],
        });
    });
});
