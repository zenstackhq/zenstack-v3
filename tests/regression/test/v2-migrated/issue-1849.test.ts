import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1849', () => {
    it('verifies issue 1849', async () => {
        await loadSchema(
            `
import './enum'

datasource db {
  provider = 'sqlite'
  url      = 'file:./dev.db'
}

model Post {
  id Int @id
  status Status @default(PUBLISHED)
}`,
            {
                enum: `
enum Status {
  PENDING
  PUBLISHED
}
`,
            },
        );
    });
});
