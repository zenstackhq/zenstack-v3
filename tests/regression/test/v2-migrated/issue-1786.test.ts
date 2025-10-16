import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1786', () => {
    it('verifies issue 1786', async () => {
        await loadSchema(
            `
    model User {
        id       String @id @default(cuid())
        email    String @unique @email @length(6, 32)
        contents    Content[]

        // everybody can signup
        @@allow('create', true)

        // full access by self
        @@allow('all', auth() == this)
    }

    type BaseContent {
      published Boolean @default(false)

      @@index([published])
    }

    model Content with BaseContent {
        id       String @id @default(cuid())
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
        owner User @relation(fields: [ownerId], references: [id])
        ownerId String
        contentType String

        @@delegate(contentType)
    }

    model Post extends Content {
        title String
    }

    model Video extends Content {
        name String
        duration Int
    }
        `,
        );
    });
});
