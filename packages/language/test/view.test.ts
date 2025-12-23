import { describe, expect, it } from 'vitest';
import { loadSchema, loadSchemaWithError } from './utils';

describe('View tests', () => {
    it('works with regular views', async () => {
        await expect(
            loadSchema(
                `
datasource db {
    provider = 'sqlite'
}

view A {
    x Int
}
        `,
            ),
        ).resolves.toBeTruthy();
    });

    it('does not allow id or index on views', async () => {
        await expect(
            loadSchemaWithError(
                `
datasource db {
    provider = 'sqlite'
}

view A {
    id Int @id
}
        `,
                '`@id` is not allowed for views',
            ),
        );

        await expect(
            loadSchemaWithError(
                `
datasource db {
    provider = 'sqlite'
}

view A {
    id Int
    @@id([id])
}
        `,
                '`@@id` is not allowed for views',
            ),
        );

        await expect(
            loadSchemaWithError(
                `
datasource db {
    provider = 'sqlite'
}

view A {
    id Int
    @@index([id])
}
        `,
                '`@@index` is not allowed for views',
            ),
        );
    });

    it('allows @@unique on views', async () => {
        await expect(
            loadSchema(`
datasource db {
    provider = 'sqlite'
}

view A {
    x Int
    @@unique([x])
}
    `),
        ).resolves.toBeTruthy();
    });
});
