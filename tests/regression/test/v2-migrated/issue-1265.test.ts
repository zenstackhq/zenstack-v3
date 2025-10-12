import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: zod schema support
it.skip('verifies issue 1265', async () => {
    const { zodSchemas } = await createTestClient(
        `
            model User {
                id String @id @default(uuid())
                posts Post[]              
                @@allow('all', true)
            }
            
            model Post {
                id String @id @default(uuid())
                title String @default('xyz')
                userId String @default(auth().id)
                user User @relation(fields: [userId], references: [id])
                @@allow('all', true)
            }
            `,
    );

    expect(zodSchemas.models.PostCreateSchema.safeParse({ title: 'Post 1' }).success).toBeTruthy();
    expect(zodSchemas.input.PostInputSchema.create.safeParse({ data: { title: 'Post 1' } }).success).toBeTruthy();
});
