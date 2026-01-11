import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #584', () => {
    it('correctly validates JSON default values', async () => {
        await expect(
            createTestClient(
                `
model Foo {
  id String @id @default(cuid())
  data Json? @default(null)
}
`,
                { usePrismaPush: true },
            ),
        ).rejects.toThrow('expected a JSON string literal');

        await expect(
            createTestClient(
                `
model Foo {
  id String @id @default(cuid())
  data Json? @default('hello')
}
`,
                { usePrismaPush: true },
            ),
        ).rejects.toThrow('expected a JSON string literal');

        await expect(
            createTestClient(
                `
model Foo {
  id String @id @default(cuid())
  data Json? @default('"hello"')
}
`,
                { usePrismaPush: true },
            ),
        ).toResolveTruthy();

        await expect(
            createTestClient(
                `
model Foo {
  id String @id @default(cuid())
  data Json? @default('[{"hello":1}]')
}
`,
                { usePrismaPush: true },
            ),
        ).toResolveTruthy();

        await expect(
            createTestClient(
                `
model Foo {
  id String @id @default(cuid())
  data Json? @default('null')
}
`,
                { usePrismaPush: true },
            ),
        ).toResolveTruthy();
    });
});
