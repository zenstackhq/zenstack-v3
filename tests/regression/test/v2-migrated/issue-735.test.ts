import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #735', () => {
    it('verifies issue 735', async () => {
        await loadSchema(
            `
        model MyModel {
            id String @id @default(cuid())
            view String
            import Int
        }

        model view {
            id String @id @default(cuid())
            name String
        }
        `,
        );
    });
});
