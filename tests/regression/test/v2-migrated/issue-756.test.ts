import { loadSchemaWithError } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 756', async () => {
    await loadSchemaWithError(
        `
        generator client {
            provider = "prisma-client-js"
        }
            
        datasource db {
            provider = "postgresql"
            url      = env("DATABASE_URL")
        }
                    
        model User {
            id Int @id @default(autoincrement())
            email Int
            posts Post[]
          }
          
          model Post {
            id Int @id @default(autoincrement())
            author User? @relation(fields: [authorId], references: [id])
            authorId Int
            @@allow('all', auth().posts.authorId == authorId)
          }
        `,
        `Could not resolve reference to MemberAccessTarget named 'authorId'.`,
    );
});
