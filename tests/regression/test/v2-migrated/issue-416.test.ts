import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #416', () => {
    it('verifies issue 416', async () => {
        await loadSchema(
            `
datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
}

model Example {
    id Int @id
    doubleQuote String @default("s\\"1")
    singleQuote String @default('s\\'1')
    json Json @default("{\\"theme\\": \\"light\\", \\"consoleDrawer\\": false}")
}
        `,
        );
    });
});
