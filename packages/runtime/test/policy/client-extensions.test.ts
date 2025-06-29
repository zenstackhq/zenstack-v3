import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/client';
import { createPolicyTestClient } from './utils';

describe('client extensions tests for polices', () => {
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
            id: 'prisma-extension-queryOverride',
            onQuery: {
                model: {
                    findMany({ args, query }: any) {
                        args = args ?? {};
                        args.where = { ...args.where, y: { lt: 300 } };
                        return query(args);
                    },
                },
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
            id: 'prisma-extension-queryOverride',
            onQuery: {
                $allModels: {
                    async findMany({ args, query }: any) {
                        args = args ?? {};
                        args.where = { ...args.where, y: { lt: 300 } };
                        console.log('findMany args:', args);
                        return query(args);
                    },
                },
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
            id: 'prisma-extension-queryOverride',
            onQuery: {
                model: {
                    async $allOperations({ args, query }: any) {
                        args = args ?? {};
                        args.where = { ...args.where, y: { lt: 300 } };
                        return query(args);
                    },
                },
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
            id: 'prisma-extension-queryOverride',
            onQuery: {
                $allModels: {
                    $allOperations({ args, query }: any) {
                        args = args ?? {};
                        args.where = { ...args.where, y: { lt: 300 } };
                        return query(args);
                    },
                },
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
            id: 'prisma-extension-resultMutation',
            onQuery: {
                model: {
                    async findMany({ args, query }: any) {
                        const r: any = await query(args);
                        for (let i = 0; i < r.length; i++) {
                            r[i].value = r[i].value + 1;
                        }
                        return r;
                    },
                },
            },
        });

        const expected = [expect.objectContaining({ value: 2 })];
        await expect(db.$use(ext).model.findMany()).resolves.toEqual(expected);
        await expect(db.$use(ext).model.findMany()).resolves.toEqual(expected);
    });
});
