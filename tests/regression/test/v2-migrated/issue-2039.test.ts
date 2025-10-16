import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2039', () => {
    it('verifies issue 2039', async () => {
        const db = await createTestClient(
            `
    type Foo {
        a String
    }

    model Bar {
        id         String   @id   @default(cuid())
        foo        Foo      @json @default("{ \\"a\\": \\"a\\" }")
        fooList    Foo[]    @json @default("[{ \\"a\\": \\"b\\" }]")
        @@allow('all', true)
    }
                `,
            { provider: 'postgresql' },
        );

        // Ensure default values are correctly set
        await expect(db.bar.create({ data: {} })).resolves.toMatchObject({
            id: expect.any(String),
            foo: { a: 'a' },
            fooList: [{ a: 'b' }],
        });
    });
});
