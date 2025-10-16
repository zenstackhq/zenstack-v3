import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1835', () => {
    it('verifies issue 1835', async () => {
        await loadSchema(
            `
enum Enum {
    SOME_VALUE
    ANOTHER_VALUE
}

model Model {
    id String @id @default(cuid())
    value Enum
    @@ignore
}

model AnotherModel {
    id String @id @default(cuid())
}
`,
        );
    });
});
