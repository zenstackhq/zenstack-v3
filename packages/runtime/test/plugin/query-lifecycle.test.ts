import { beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../test-schema';
import { ZenStackClient, type ClientContract } from '../../src/client';
import { NotFoundError } from '../../src/client/errors';

describe('Query lifecycle tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await new ZenStackClient(schema);
        await client.$pushSchema();
    });

    it('supports before query hooks', async () => {
        let beforeQueryCalled = false;
        const extClient = client.$use({
            id: 'test-plugin',
            beforeQuery(args) {
                beforeQueryCalled = true;
                expect(args).toMatchObject({
                    model: 'User',
                    operation: 'findFirst',
                    args: { where: { id: '1' } },
                });
            },
        });

        await extClient.user.findFirst({
            where: { id: '1' },
        });
        expect(beforeQueryCalled).toBe(true);
    });

    it('supports after query hooks with result', async () => {
        let afterQueryCalled = false;
        const extClient = client.$use({
            id: 'test-plugin',
            afterQuery(args) {
                afterQueryCalled = true;
                expect(args).toMatchObject({
                    model: 'User',
                    operation: 'findFirst',
                    args: { where: { id: '1' } },
                    result: null,
                });
                expect(args.error).toBeUndefined();
            },
        });

        await extClient.user.findFirst({
            where: { id: '1' },
        });
        expect(afterQueryCalled).toBe(true);
    });

    it('supports after query hooks with error', async () => {
        let afterQueryCalled = false;
        const extClient = client.$use({
            id: 'test-plugin',
            afterQuery(args) {
                afterQueryCalled = true;
                expect(args).toMatchObject({
                    model: 'User',
                    operation: 'findFirst',
                    args: { where: { id: '1' } },
                    error: expect.any(NotFoundError),
                });
                expect(args.result).toBeUndefined();
            },
        });

        try {
            await extClient.user.findFirstOrThrow({
                where: { id: '1' },
            });
        } catch {}
        expect(afterQueryCalled).toBe(true);
    });
});
