import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1415', () => {
    it('verifies issue 1415', async () => {
        await loadSchema(
            `
model User {
  id    String @id @default(cuid())
  prices Price[]
}

model Price {
  id        String   @id @default(cuid())
  owner User @relation(fields: [ownerId], references: [id])
  ownerId String @default(auth().id)
  priceType    String
  @@delegate(priceType)
}
            `,
        );
    });
});
