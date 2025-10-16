import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1257', () => {
    it('verifies issue 1257', async () => {
        await loadSchema(
            `
import "./user"
import "./image"

datasource db {
  provider   = "postgresql"
  url       = env("DATABASE_URL")
}`,
            {
                base: `
type Base {
  id Int @id @default(autoincrement())
}
`,
                user: `
import "./base"
import "./image"

enum Role {
  Admin
}

model User with Base {
  email String @unique
  role Role
  @@auth
}
`,
                image: `
import "./user"
import "./base"

model Image with Base {
    width Int @default(0)
    height Int @default(0)

    @@allow('read', true)
    @@allow('all', auth().role == Admin)
}
`,
            },
        );
    });
});
