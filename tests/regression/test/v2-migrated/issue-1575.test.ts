import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1575', () => {
    it('verifies issue 1575', async () => {
        await loadSchema(
            `
model UserAssets {
    id       String @id @default(cuid())
    videoId         String
    videoStream     Asset @relation("userVideo", fields: [videoId], references: [id])
    subtitleId      String
    subtitlesAsset  Asset @relation("userSubtitles", fields: [subtitleId], references: [id])
}

model Asset {
    id              String @id @default(cuid())
    type            String
    userVideo       UserAssets[] @relation("userVideo")
    userSubtitles   UserAssets[] @relation("userSubtitles")

    @@delegate(type)
}

model Movie extends Asset {
    duration    Int
}
            `,
        );
    });
});
