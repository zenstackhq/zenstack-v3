import { loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #283', () => {
    it('verifies issue 283', async () => {
        await loadSchemaWithError(
            `
model Base {
    id Int @id @default(autoincrement())
    x Int
    type String
    @@delegate(type)
}

model Sub extends Base {
    y Int
    @@index([x, y])
}
`,
            'Cannot use fields inherited from a polymorphic base model',
        );
    });
});
