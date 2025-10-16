import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1167', () => {
    it('verifies issue 1167', async () => {
        await loadSchema(
            `
model FileAsset {
    id String @id @default(cuid())
    delegate_type String
    @@delegate(delegate_type)
    @@map("file_assets")
}

model ImageAsset extends FileAsset {
    @@map("image_assets")
}
            `,
        );
    });
});
