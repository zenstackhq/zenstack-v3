import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('regression', async () => {
    await loadSchema(
        `
type Base {
  id String @id @default(uuid())
}

model User with Base {
  email String
  posts Post[]
  @@allow('all', auth() == this)
}

model Post {
  id String @id @default(uuid())

  user User @relation(fields: [userId], references: [id])
  userId String
  @@allow('all', auth().id == userId)
}
            `,
    );
});
