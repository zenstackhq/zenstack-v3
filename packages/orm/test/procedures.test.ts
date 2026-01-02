import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';

import { ZenStackClient } from '../src/client/client-impl';
import { definePlugin } from '../src/client/plugin';

const baseSchema = {
    provider: { type: 'sqlite' },
    models: {},
    enums: {},
    typeDefs: {},
} as const;

describe('ORM procedures', () => {
    it('exposes `$procs`', async () => {
        const schema: any = {
            ...baseSchema,
            procedures: {
                hello: { params: [], returnType: 'String' },
            },
        };

        const client: any = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
            procedures: {
                hello: async () => 'ok',
            },
        });

        expect(typeof client.$procs.hello).toBe('function');
        expect(await client.$procs.hello()).toBe('ok');
    });

    it('throws config error when procedures are not configured', async () => {
        const schema: any = {
            ...baseSchema,
            procedures: {
                hello: { params: [], returnType: 'String' },
            },
        };

        const client: any = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        } as any);

        await expect(client.$procs.hello()).rejects.toThrow(/not configured/i);
    });

    it('throws error when a procedure handler is missing', async () => {
        const schema: any = {
            ...baseSchema,
            procedures: {
                hello: { params: [], returnType: 'String' },
            },
        };

        const client: any = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
            procedures: {},
        } as any);

        await expect(client.$procs.hello()).rejects.toThrow(/does not have a handler configured/i);
    });

    it('validates procedure args against schema', async () => {
        const schema: any = {
            ...baseSchema,
            procedures: {
                echoInt: {
                    params: [{ name: 'n', type: 'Int' }],
                    returnType: 'Int',
                },
            },
        };

        const client: any = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
            procedures: {
                echoInt: async ({ args }: any) => args.n,
            },
        });

        await expect(client.$procs.echoInt({ args: { n: '1' } })).rejects.toThrow(/invalid input/i);
    });

    it('runs procedure through onProcedure hooks', async () => {
        const schema: any = {
            ...baseSchema,
            procedures: {
                add: {
                    params: [
                        { name: 'a', type: 'Int' },
                        { name: 'b', type: 'Int' },
                    ],
                    returnType: 'Int',
                },
            },
        };

        const calls: string[] = [];

        const p1 = definePlugin({
            id: 'p1',
            onProcedure: async (ctx) => {
                calls.push(`p1:${ctx.name}`);
                return ctx.proceed(ctx.input);
            },
        });

        const p2 = definePlugin({
            id: 'p2',
            onProcedure: async (ctx) => {
                calls.push(`p2:${ctx.name}`);
                // mutate args: add +1 to `a`
                const nextInput: any = {
                    ...(ctx.input as any),
                    args: {
                        ...((ctx.input as any)?.args ?? {}),
                        a: Number((ctx.input as any)?.args?.a) + 1,
                    },
                };
                return ctx.proceed(nextInput);
            },
        });

        const client: any = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
            plugins: [p1, p2],
            procedures: {
                add: async ({ args }: any) => args.a + args.b,
            },
        });

        await expect(client.$procs.add({ args: { a: 1, b: 2 } })).resolves.toBe(4);
        expect(calls).toEqual(['p2:add', 'p1:add']);
    });
});
