import { isCuid } from '@paralleldrive/cuid2';
import SQLite from 'better-sqlite3';
import { isValid as isValidUlid } from 'ulid';
import { validate as isValidUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { ZenStackClient } from '../../src';
import { ExpressionUtils, type SchemaDef } from '../../src/schema';

const schema = {
    provider: {
        type: 'sqlite',
    },
    models: {
        Model: {
            fields: {
                uuid: {
                    type: 'String',
                    id: true,
                    default: ExpressionUtils.call('uuid'),
                },
                uuid7: {
                    type: 'String',
                    default: ExpressionUtils.call('uuid', [ExpressionUtils.literal(7)]),
                },
                cuid: {
                    type: 'String',
                    default: ExpressionUtils.call('cuid'),
                },
                cuid2: {
                    type: 'String',
                    default: ExpressionUtils.call('cuid', [ExpressionUtils.literal(2)]),
                },
                nanoid: {
                    type: 'String',
                    default: ExpressionUtils.call('nanoid'),
                },
                nanoid8: {
                    type: 'String',
                    default: ExpressionUtils.call('nanoid', [ExpressionUtils.literal(8)]),
                },
                ulid: {
                    type: 'String',
                    default: ExpressionUtils.call('ulid'),
                },
                dt: {
                    type: 'DateTime',
                    default: ExpressionUtils.call('now'),
                },
            },
            idFields: ['uuid'],
            uniqueFields: {
                uuid: { type: 'String' },
            },
        },
    },
    plugins: {},
} as const satisfies SchemaDef;

describe('default values tests', () => {
    it('supports generators', async () => {
        const client = new ZenStackClient(schema, {
            dialectConfig: { database: new SQLite(':memory:') },
        });
        await client.$pushSchema();

        const entity = await client.model.create({ data: {} });
        expect(entity.uuid).toSatisfy(isValidUuid);
        expect(entity.uuid7).toSatisfy(isValidUuid);
        expect(entity.cuid).toSatisfy(isCuid);
        expect(entity.cuid2).toSatisfy(isCuid);
        expect(entity.nanoid).toSatisfy((id) => id.length >= 21);
        expect(entity.nanoid8).toSatisfy((id) => id.length === 8);
        expect(entity.ulid).toSatisfy(isValidUlid);
        expect(entity.dt).toBeInstanceOf(Date);
    });
});
