import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression tests for issue 505', () => {
    it('verifies the issue', async () => {
        const db = await createTestClient(
            `
model Media {
  id        String   @id @default(cuid())
  type      String
  @@delegate(type)

  messages   Message[]
}

model TelegramPhoto extends Media {
  tgFileId String @unique
  width          Int
  height         Int
}

model Message {
  id        String      @id @default(cuid())
  media     Media[]
  type String
  @@delegate(type)
}

model TelegramMessage extends Message {
  tgId BigInt @unique
}
`,
            { usePrismaPush: true },
        );

        const photo = await db.telegramPhoto.create({
            data: {
                tgFileId: 'file123',
                width: 800,
                height: 600,
            },
        });

        const message = await db.telegramMessage.create({
            data: {
                tgId: BigInt(1),
                media: {
                    connect: {
                        id: photo.id,
                    },
                },
            },
            include: {
                media: true,
            },
        });

        expect(message).toMatchObject({
            media: [photo],
        });

        const media = await db.media.findFirst({
            include: { messages: true },
        });
        expect(media).toMatchObject({
            messages: [expect.objectContaining({ tgId: BigInt(1), type: 'TelegramMessage' })],
        });
    });
});
