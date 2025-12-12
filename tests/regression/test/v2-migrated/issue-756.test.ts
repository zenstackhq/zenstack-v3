import { loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #756', () => {
    it('verifies issue 756', async () => {
        await loadSchemaWithError(
            `
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
});
