import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1693', () => {
    it('verifies issue 1693', async () => {
        await loadSchema(
            `
model Animal {
    id String @id @default(uuid())
    animalType String @default("")
    @@delegate(animalType)
}

model Dog extends Animal {
    name String
}
            `,
        );
    });
});
