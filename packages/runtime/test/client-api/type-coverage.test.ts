import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

const PG_DB_NAME = 'client-api-type-coverage-tests';

describe.each(['sqlite', 'postgresql'] as const)('zmodel type coverage tests', (provider) => {
    it('supports all types - plain', async () => {
        const date = new Date();
        const data = {
            id: '1',
            String: 'string',
            Int: 100,
            BigInt: BigInt(9007199254740991),
            DateTime: date,
            Float: 1.23,
            Decimal: new Decimal(1.2345),
            Boolean: true,
            Bytes: new Uint8Array([1, 2, 3, 4]),
            Json: { foo: 'bar' },
        };

        let db: any;
        try {
            db = await createTestClient(
                `
            model Foo {
                id String @id @default(cuid())

                String String
                Int Int
                BigInt BigInt
                DateTime DateTime
                Float Float
                Decimal Decimal
                Boolean Boolean
                Bytes Bytes
                Json Json

                @@allow('all', true)
            }
            `,
                { provider, dbName: PG_DB_NAME },
            );

            await db.foo.create({ data });
            await expect(db.foo.findUnique({ where: { id: '1' } })).resolves.toMatchObject(data);
        } finally {
            await db?.$disconnect();
        }
    });

    it('supports all types - array', async () => {
        if (provider === 'sqlite') {
            return;
        }

        const date = new Date();
        const data = {
            id: '1',
            String: ['string'],
            Int: [100],
            BigInt: [BigInt(9007199254740991)],
            DateTime: [date],
            Float: [1.23],
            Decimal: [new Decimal(1.2345)],
            Boolean: [true],
            Bytes: [new Uint8Array([1, 2, 3, 4])],
            Json: [{ foo: 'bar' }],
        };

        let db: any;
        try {
            db = await createTestClient(
                `
            model Foo {
                id String @id @default(cuid())

                String String[]
                Int Int[]
                BigInt BigInt[]
                DateTime DateTime[]
                Float Float[]
                Decimal Decimal[]
                Boolean Boolean[]
                Bytes Bytes[]
                Json Json[]

                @@allow('all', true)
            }
            `,
                { provider, dbName: PG_DB_NAME },
            );

            await db.foo.create({ data });
            await expect(db.foo.findUnique({ where: { id: '1' } })).resolves.toMatchObject(data);
        } finally {
            await db?.$disconnect();
        }
    });
});
