import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Issue 493 regression tests', () => {
    it('should correctly handle JSON and typed-JSON array fields for PostgreSQL', async () => {
        const schema = `
type InlineButton {
    id            String
    text          String
    callback_data String?
    url           String?
    message       String?
    type          String?
}

type BotButton {
    id             String
    label          String
    action         String
    enabled        Boolean
    order_index    Int
    message        String
    inline_buttons InlineButton[]?  // Nested custom type
}

model bot_settings {
    id           Int         @id @default(autoincrement())
    setting_key  String      @unique
    menu_buttons BotButton[] @json  // Array of custom type
    meta         Meta        @json
}

type Meta {
    info String
}

model Foo {
    id   Int  @id @default(autoincrement())
    data Json
}
`;

        const db = await createTestClient(schema, { provider: 'postgresql' });

        // plain JSON non-array
        await expect(
            db.foo.create({
                data: {
                    data: { hello: 'world' },
                },
            }),
        ).resolves.toMatchObject({
            data: { hello: 'world' },
        });

        // plain JSON array
        await expect(
            db.foo.create({
                data: {
                    data: [{ hello: 'world' }],
                },
            }),
        ).resolves.toMatchObject({
            data: [{ hello: 'world' }],
        });

        // typed-JSON array & non-array
        const input = {
            setting_key: 'abc',
            menu_buttons: [
                {
                    id: '1',
                    label: 'Button 1',
                    action: 'action_1',
                    enabled: true,
                    order_index: 1,
                    message: 'msg',
                    inline_buttons: [
                        {
                            id: 'ib1',
                            text: 'Inline 1',
                        },
                    ],
                },
            ],
            meta: { info: 'some info' },
        };
        await expect(
            db.bot_settings.create({
                data: input,
            }),
        ).resolves.toMatchObject(input);
    });
});
