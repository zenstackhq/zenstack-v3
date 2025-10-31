import { isCuid } from '@paralleldrive/cuid2';
import { ZenStackClient } from '@zenstackhq/orm';
import { ExpressionUtils, type SchemaDef } from '@zenstackhq/orm/schema';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { isValid as isValidUlid } from 'ulid';
import { validate as isValidUuid } from 'uuid';
import { describe, expect, it } from 'vitest';

const schema = {
    provider: {
        type: 'sqlite',
    },
    models: {
        Model: {
            name: 'Model',
            fields: {
                id: {
                    name: 'id',
                    type: 'Int',
                    id: true,
                },
                uuid: {
                    name: 'uuid',
                    type: 'String',
                    default: ExpressionUtils.call('uuid'),
                },
                uuid7: {
                    name: 'uuid7',
                    type: 'String',
                    default: ExpressionUtils.call('uuid', [ExpressionUtils.literal(7)]),
                },
                cuid: {
                    name: 'cuid',
                    type: 'String',
                    default: ExpressionUtils.call('cuid'),
                },
                cuid2: {
                    name: 'cuid2',
                    type: 'String',
                    default: ExpressionUtils.call('cuid', [ExpressionUtils.literal(2)]),
                },
                nanoid: {
                    name: 'nanoid',
                    type: 'String',
                    default: ExpressionUtils.call('nanoid'),
                },
                nanoid8: {
                    name: 'nanoid8',
                    type: 'String',
                    default: ExpressionUtils.call('nanoid', [ExpressionUtils.literal(8)]),
                },
                ulid: {
                    name: 'ulid',
                    type: 'String',
                    default: ExpressionUtils.call('ulid'),
                },
                dt: {
                    name: 'dt',
                    type: 'DateTime',
                    default: ExpressionUtils.call('now'),
                },
                bool: {
                    name: 'bool',
                    type: 'Boolean',
                    default: false,
                },
            },
            idFields: ['id'],
            uniqueFields: {
                id: { type: 'Int' },
            },
        },
    },
    plugins: {},
} as const satisfies SchemaDef;

describe('default values tests', () => {
    it('supports defaults', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();

        const entity = await client.model.create({ data: { id: 1 } });
        expect(entity.uuid).toSatisfy(isValidUuid);
        expect(entity.uuid7).toSatisfy(isValidUuid);
        expect(entity.cuid).toSatisfy(isCuid);
        expect(entity.cuid2).toSatisfy(isCuid);
        expect(entity.nanoid).toSatisfy((id) => id.length >= 21);
        expect(entity.nanoid8).toSatisfy((id) => id.length === 8);
        expect(entity.ulid).toSatisfy(isValidUlid);
        expect(entity.dt).toBeInstanceOf(Date);

        // some fields are set but some use default
        await expect(
            client.model.createMany({
                data: [{ id: 2 }, { id: 3, bool: true }],
            }),
        ).toResolveTruthy();
        await expect(client.model.findUnique({ where: { id: 2 } })).resolves.toMatchObject({
            bool: false,
        });
        await expect(client.model.findUnique({ where: { id: 3 } })).resolves.toMatchObject({
            bool: true,
        });
    });
});
