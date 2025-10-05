import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

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
