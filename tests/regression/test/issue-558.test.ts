import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #558', () => {
    it('verifies issue 558', async () => {
        const db = await createTestClient(`
type Foo {
    x Int
}

model Model {
    id String @id @default(cuid())
    foo Foo @json
}
        `);

        await expect(db.model.create({ data: { foo: { x: 'hello' } } })).rejects.toThrow('data.foo.x');
    });
});
