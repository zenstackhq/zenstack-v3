import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1857', () => {
    it('verifies issue 1857', async () => {
        await createTestClient(
            `
            type JSONContent {
                type String
                text String?
            }

            model Post {
                id String @id @default(uuid())
                content JSONContent @json
                @@allow('all', true)
            }
            `,
            {
                extraSourceFiles: {
                    main: `
            import { ZenStackClient } from '@zenstackhq/orm';
            import { schema } from './schema';

            async function main() {
                const db = new ZenStackClient(schema, {} as any);
                await db.post.create({
                    data: {
                        content: { type: 'foo', text: null }
                    }
                });
            }
                `,
                },
            },
        );

        // TODO: zod schema support
        // zodSchemas.models.JSONContentSchema.parse({ type: 'foo', text: null });
    });
});
