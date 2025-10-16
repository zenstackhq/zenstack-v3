import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1695', () => {
    it('verifies issue 1695', async () => {
        await loadSchema(
            `
type SoftDelete {
    deleted Int @default(0)
}

model MyModel with SoftDelete {
    id      String @id @default(cuid())
    name    String

    @@deny('update', deleted != 0)
    @@deny('post-update', deleted != 0)
    @@deny('read', this.deleted != 0)
}
            `,
        );
    });
});
