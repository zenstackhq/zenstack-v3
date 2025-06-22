import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

describe('zmodel type coverage tests', () => {
    it('supports all types', async () => {
        const db = await createTestClient(
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

                @@allow('all', true)
            }
            `,
        );

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
        };

        await db.foo.create({ data });

        const r = await db.foo.findUnique({ where: { id: '1' } });
        expect(r.Bytes).toEqual(data.Bytes);
    });
});
