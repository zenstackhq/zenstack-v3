import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

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
