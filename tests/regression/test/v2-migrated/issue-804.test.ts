import { loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #804', () => {
    it('verifies issue 804', async () => {
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
            published Boolean

            @@allow('all', auth().posts?[published] == 'TRUE')
        }
        `,
            'incompatible operand types',
        );
    });
});
