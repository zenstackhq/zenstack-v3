import { isCuid } from '@paralleldrive/cuid2';
import SQLite from 'better-sqlite3';
import { isValid as isValidUlid } from 'ulid';
import { validate as isValidUuid } from 'uuid';
import { describe, expect, it } from 'vitest';
import { ZenStackClient } from '../../src';
import type { SchemaDef } from '../../src/schema';

const schema = {
    provider: {
        type: 'sqlite',
        dialectConfigProvider: () =>
            ({
                database: new SQLite(':memory:'),
            } as any),
    },
    models: {
        Model: {
            fields: {
                uuid: {
                    type: 'String',
                    id: true,
                    default: { call: 'uuid' },
                },
                uuid7: {
                    type: 'String',
                    default: { call: 'uuid', args: [7] },
                },
                cuid: {
                    type: 'String',
                    default: { call: 'cuid' },
                },
                cuid2: {
                    type: 'String',
                    default: { call: 'cuid', args: [2] },
                },
                nanoid: {
                    type: 'String',
                    default: { call: 'nanoid' },
                },
                nanoid8: {
                    type: 'String',
                    default: { call: 'nanoid', args: [8] },
                },
                ulid: {
                    type: 'String',
                    default: {
                        call: 'ulid',
                    },
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

describe('Default Value Providers', () => {
    it('supports generators', async () => {
        const client = new ZenStackClient(schema);
        await client.$pushSchema();

        const entity = await client.model.create({ data: {} });
        expect(entity.uuid).toSatisfy(isValidUuid);
        expect(entity.uuid7).toSatisfy(isValidUuid);
        expect(entity.cuid).toSatisfy(isCuid);
        expect(entity.cuid2).toSatisfy(isCuid);
        expect(entity.nanoid).toSatisfy((id) => id.length >= 21);
        expect(entity.nanoid8).toSatisfy((id) => id.length === 8);
        expect(entity.ulid).toSatisfy(isValidUlid);
    });
});
