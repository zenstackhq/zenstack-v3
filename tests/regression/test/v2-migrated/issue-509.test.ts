import { loadDocument } from '@zenstackhq/language';
import { describe, it } from 'vitest';

describe('Regression for issue #509', () => {
    it('verifies issue 509', async () => {
        await loadDocument(
            `
            model User {
                id Int @id @default(autoincrement())
                email String @unique
                name String?
                posts Post[]
            }

            model Post {
                id Int @id @default(autoincrement())
                title String
                content String?
                published Boolean @default(false)
                author User? @relation(fields: [authorId], references: [id])
                authorId Int?

                deleted Boolean @default(false) @omit

                @@allow('all', true)
                @@deny('read', deleted)
            }
            `,
        );
    });
});
