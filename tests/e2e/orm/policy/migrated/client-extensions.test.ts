import { definePlugin } from '@zenstackhq/orm';
import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('client extensions tests for policies', () => {
    it('query override one model', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x Int
            y Int
        
            @@allow('read', x > 0)
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { x: 0, y: 100 } });
        await rawDb.model.create({ data: { x: 1, y: 200 } });
        await rawDb.model.create({ data: { x: 2, y: 300 } });

        const ext = definePlugin({
            id: 'queryOverride',
            onQuery: async ({ args, proceed }: any) => {
                args = args ?? {};
                args.where = { ...args.where, y: { lt: 300 } };
                return proceed(args);
            },
        });

        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
    });

    it('query override all models', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x Int
            y Int
        
            @@allow('read', x > 0)
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { x: 0, y: 100 } });
        await rawDb.model.create({ data: { x: 1, y: 200 } });
        await rawDb.model.create({ data: { x: 2, y: 300 } });

        const ext = definePlugin({
            id: 'queryOverride',
            onQuery: async ({ args, proceed }: any) => {
                args = args ?? {};
                args.where = { ...args.where, y: { lt: 300 } };
                return proceed(args);
            },
        });

        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
    });

    it('query override all operations', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x Int
            y Int

            @@allow('read', x > 0)
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { x: 0, y: 100 } });
        await rawDb.model.create({ data: { x: 1, y: 200 } });
        await rawDb.model.create({ data: { x: 2, y: 300 } });

        const ext = definePlugin({
            id: 'queryOverride',
            onQuery: async ({ args, proceed }: any) => {
                args = args ?? {};
                args.where = { ...args.where, y: { lt: 300 } };
                return proceed(args);
            },
        });

        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
    });

    it('query override everything', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x Int
            y Int

            @@allow('read', x > 0)
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { x: 0, y: 100 } });
        await rawDb.model.create({ data: { x: 1, y: 200 } });
        await rawDb.model.create({ data: { x: 2, y: 300 } });

        const ext = definePlugin({
            id: 'queryOverride',
            onQuery: async ({ args, proceed }: any) => {
                args = args ?? {};
                args.where = { ...args.where, y: { lt: 300 } };
                return proceed(args);
            },
        });

        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
        await expect(db.$use(ext).model.findMany()).resolves.toHaveLength(1);
    });

    it('result mutation', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int

            @@allow('read', value > 0)
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { value: 0 } });
        await rawDb.model.create({ data: { value: 1 } });

        const ext = definePlugin({
            id: 'resultMutation',
            onQuery: async ({ args, proceed }: any) => {
                const r: any = await proceed(args);
                for (let i = 0; i < r.length; i++) {
                    r[i].value = r[i].value + 1;
                }
                return r;
            },
        });

        const expected = [expect.objectContaining({ value: 2 })];
        await expect(db.$use(ext).model.findMany()).resolves.toEqual(expected);
        await expect(db.$use(ext).model.findMany()).resolves.toEqual(expected);
    });
});
