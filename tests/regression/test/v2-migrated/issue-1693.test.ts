import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

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
