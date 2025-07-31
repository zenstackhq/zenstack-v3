import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import { ZenStackClient } from '../../src';
import { type SchemaDef, ExpressionUtils } from '../../src/schema';

describe('Name mapping tests', () => {
    const schema = {
        provider: {
            type: 'sqlite',
        },
        models: {
            Foo: {
                name: 'Foo',
                fields: {
                    id: {
                        name: 'id',
                        type: 'String',
                        id: true,
                        default: ExpressionUtils.call('uuid'),
                    },
                    x: {
                        name: 'x',
                        type: 'Int',
                        attributes: [
                            {
                                name: '@map',
                                args: [
                                    {
                                        name: 'name',
                                        value: {
                                            kind: 'literal',
                                            value: 'y',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                idFields: ['id'],
                uniqueFields: {
                    id: { type: 'String' },
                },
                attributes: [
                    {
                        name: '@@map',
                        args: [
                            {
                                name: 'name',
                                value: { kind: 'literal', value: 'bar' },
                            },
                        ],
                    },
                ],
            },
        },
        plugins: {},
    } as const satisfies SchemaDef;

    it('works with model and implicit field mapping', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();
        const r1 = await client.foo.create({
            data: { id: '1', x: 1 },
        });
        expect(r1.id).toBe('1');
        expect(r1.x).toBe(1);
        expect((r1 as any).y).toBeUndefined();

        const r2 = await client.foo.findUniqueOrThrow({
            where: { id: '1' },
        });
        expect(r2.id).toBe('1');
        expect(r2.x).toBe(1);
        expect((r2 as any).y).toBeUndefined();

        const r3 = await client.$qb
            .insertInto('Foo')
            .values({ id: '2', x: 2 })
            .returningAll()
            .executeTakeFirstOrThrow();
        expect(r3.id).toBe('2');
        expect(r3.x).toBe(2);
        expect((r3 as any).y).toBeUndefined();

        const delResult = await client.foo.delete({ where: { id: '1' } });
        expect(delResult.x).toBe(1);
    });

    it('works with explicit field mapping', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();
        const r1 = await client.foo.create({
            data: { id: '1', x: 1 },
            select: { x: true },
        });
        expect(r1.x).toBe(1);
        expect((r1 as any).y).toBeUndefined();

        const r2 = await client.foo.findUniqueOrThrow({
            where: { id: '1' },
            select: { x: true },
        });
        expect(r2.x).toBe(1);
        expect((r2 as any).y).toBeUndefined();

        const r3 = await client.$qb
            .insertInto('Foo')
            .values({ id: '2', x: 2 })
            .returning(['x'])
            .executeTakeFirstOrThrow();
        expect(r3.x).toBe(2);
        expect((r3 as any).y).toBeUndefined();
    });
});
