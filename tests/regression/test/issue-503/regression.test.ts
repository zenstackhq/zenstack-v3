import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';
import { schema } from './schema';

describe('Regression tests for issue #503', () => {
    it('verifies the issue', async () => {
        const db = await createTestClient(schema);
        const r = await db.internalChat.create({
            data: {
                messages: {
                    create: {
                        media: {
                            create: {
                                type: 'Image',
                            },
                        },
                    },
                },
            },
            select: {
                messages: {
                    take: 1,
                    include: {
                        media: true,
                    },
                },
            },
        });
        expect(r.messages[0]?.media).toMatchObject({ type: 'Image' });
    });
});
