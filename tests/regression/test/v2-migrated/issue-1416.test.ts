import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1416', () => {
    it('verifies issue 1416', async () => {
        await loadSchema(
            `
model User {
  id   String @id @default(cuid())
  role String
}

model Price {
  id        String  @id @default(nanoid(6))
  entity    Entity? @relation(fields: [entityId], references: [id])
  entityId  String?
  priceType String
  @@delegate(priceType)
}

model MyPrice extends Price {
  foo String
}

model Entity {
  id    String  @id @default(nanoid(6))
  price Price[]
  type  String
  @@delegate(type)
}

model MyEntity extends Entity {
  foo String
}
            `,
        );
    });
});
