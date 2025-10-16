import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #971', () => {
    it('verifies issue 971', async () => {
        await loadSchema(
            `
type Level1 {
    id String @id @default(cuid())
    URL String?
    @@validate(URL != null, "URL must be provided") // works
}
type Level2 with Level1 {
    @@validate(URL != null, "URL must be provided") // works
}
type Level3 with Level2 {
    @@validate(URL != null, "URL must be provided") // doesn't work
}
model Foo with Level3 {
}
            `,
        );
    });
});
