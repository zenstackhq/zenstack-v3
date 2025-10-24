import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1135', () => {
    it('verifies issue 1135', async () => {
        const db = await createTestClient(
            `
model Attachment {
    id          String  @id @default(cuid())
    url         String
    myEntityId      String
    myEntity        Entity        @relation(fields: [myEntityId], references: [id], onUpdate: NoAction)
}

model Entity {
    id      String          @id @default(cuid())
    name    String
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt @default(now())

    attachments Attachment[]

    type String
    @@delegate(type)
}

model Person extends Entity {
    age Int?
}
            `,
            {
                extraSourceFiles: {
                    'main.ts': `
import { ZenStackClient } from '@zenstackhq/orm';
import { schema } from './schema';

const db = new ZenStackClient(schema, {} as any);

db.person.create({
    data: {
        name: 'test',
        attachments: {
            create: {
                url: 'https://...',
            },
        },
    },
});
                `,
                },
            },
        );

        await expect(
            db.person.create({
                data: {
                    name: 'test',
                    attachments: {
                        create: {
                            url: 'https://...',
                        },
                    },
                },
                include: { attachments: true },
            }),
        ).resolves.toMatchObject({
            id: expect.any(String),
            name: 'test',
            attachments: [
                {
                    id: expect.any(String),
                    url: 'https://...',
                    myEntityId: expect.any(String),
                },
            ],
        });
    });
});
