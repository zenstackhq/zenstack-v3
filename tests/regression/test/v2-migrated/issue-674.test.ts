import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

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
