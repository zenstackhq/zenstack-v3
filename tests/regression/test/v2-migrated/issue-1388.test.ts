import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1388', () => {
    it('verifies issue 1388', async () => {
        await loadSchema(
            `
import './auth'
import './post'

datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
}
`,
            {
                auth: `
model User {
  id   String @id @default(cuid())
  role String
}
  `,
                post: `
model Post {
  id        String  @id @default(nanoid(6))
  title String
  @@deny('all', auth() == null)
  @@allow('all', auth().id == 'user1')
}
  `,
            },
        );
    });
});
