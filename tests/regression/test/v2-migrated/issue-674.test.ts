import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #674', () => {
    it('verifies issue 674', async () => {
        await loadSchema(
            `
model Foo {
    id Int @id
}

enum MyUnUsedEnum { ABC CDE @@map('my_unused_enum') }
        `,
        );
    });
});
