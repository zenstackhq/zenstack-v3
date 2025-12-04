import { createTestClient } from '@zenstackhq/testtools';
import { describe, it, expect } from 'vitest';
import { schema } from '../schemas/json/schema';
import { JsonNull, DbNull, AnyNull } from '@zenstackhq/orm';

describe('Json filter tests', () => {
    it('works with simple equality filter', async () => {
        const db = await createTestClient(schema);
        await db.plainJson.create({ data: { data: { hello: 'world' } } });

        await expect(
            db.plainJson.findFirst({ where: { data: { equals: { hello: 'world' } } } }),
        ).resolves.toMatchObject({
            data: { hello: 'world' },
        });
        await expect(db.plainJson.findFirst({ where: { data: { not: { hello: 'foo' } } } })).resolves.toMatchObject({
            data: { hello: 'world' },
        });
        await expect(db.plainJson.findFirst({ where: { data: { not: { hello: 'world' } } } })).toResolveNull();
    });

    it('distinguishes between JsonNull and DbNull', async () => {
        const db = await createTestClient(schema);

        // Create records with different null types
        // Record 1: data contains JSON null, data1 is DB NULL (unset)
        const rec1 = await db.plainJson.create({ data: { data: JsonNull } });

        // Record 2: data contains object, data1 explicitly set to JSON null
        const rec2 = await db.plainJson.create({ data: { data: { foo: 'bar' }, data1: JsonNull } });

        // Record 3: data contains object, data1 is DB NULL (unset)
        const rec3 = await db.plainJson.create({ data: { data: { hello: 'world' }, data1: DbNull } });

        // Record 4: data contains object, data1 explicitly set to an object
        const rec4 = await db.plainJson.create({ data: { data: { test: 'value' }, data1: { key: 'value' } } });

        // Test JsonNull - should match JSON null value in data field
        const jsonNullResults = await db.plainJson.findMany({
            where: { data: { equals: JsonNull } },
        });
        expect(jsonNullResults).toHaveLength(1);
        expect(jsonNullResults[0]?.data).toBe(null); // JSON null is returned as null
        expect(jsonNullResults[0]?.id).toBe(rec1.id);

        // Test JsonNull in data1 field
        const jsonNullData1Results = await db.plainJson.findMany({
            where: { data1: { equals: JsonNull } },
        });
        expect(jsonNullData1Results).toHaveLength(1); // Only record 2 has data1 as JSON null
        expect(jsonNullData1Results[0]?.data1).toBe(null);
        expect(jsonNullData1Results[0]?.id).toBe(rec2.id);

        // Test NOT JsonNull - should exclude JSON null records
        const notJsonNull = await db.plainJson.findMany({
            where: { data: { not: JsonNull } },
        });
        expect(notJsonNull).toHaveLength(3); // Should exclude the JsonNull record
        expect(notJsonNull.map((r) => r.id).sort()).toEqual([rec2.id, rec3.id, rec4.id].sort());

        // Test data1 with actual value - "not JsonNull" should match DB NULL and actual objects
        const data1NotJsonNull = await db.plainJson.findMany({
            where: { data1: { not: JsonNull } },
        });
        // Records 1, 3 have DB NULL, record 4 has an object - all should match "not JsonNull"
        expect(data1NotJsonNull.length).toBe(3);

        // Test DbNull - should match database NULL values
        const dbNullResults = await db.plainJson.findMany({
            where: { data1: { equals: DbNull } },
        });
        // Records 1 and 3 have data1 as DB NULL
        expect(dbNullResults.length).toBe(2);
        expect(dbNullResults.map((r) => r.id).sort()).toEqual([rec1.id, rec3.id].sort());

        // Test AnyNull - should match both JSON null and DB NULL
        const anyNullResults = await db.plainJson.findMany({
            where: { data1: { equals: AnyNull } },
        });
        // Records 1, 2, and 3: rec1 (DB NULL), rec2 (JSON null), rec3 (DB NULL)
        expect(anyNullResults.length).toBe(3);
        expect(anyNullResults.map((r) => r.id).sort()).toEqual([rec1.id, rec2.id, rec3.id].sort());

        // invalid input
        // @ts-expect-error
        await expect(db.plainJson.create({ data: { data: null } })).toBeRejectedByValidation();
        // @ts-expect-error
        await expect(db.plainJson.create({ data: { data: DbNull } })).toBeRejectedByValidation();
        // @ts-expect-error
        await expect(db.plainJson.create({ data: { data1: null } })).toBeRejectedByValidation();
        // @ts-expect-error
        await expect(db.plainJson.update({ where: { id: rec1.id }, data: { data: null } })).toBeRejectedByValidation();
        await expect(
            // @ts-expect-error
            db.plainJson.update({ where: { id: rec1.id }, data: { data: DbNull } }),
        ).toBeRejectedByValidation();
        // @ts-expect-error
        await expect(db.plainJson.update({ where: { id: rec1.id }, data: { data1: null } })).toBeRejectedByValidation();
    });

    it('works with updates', async () => {
        const db = await createTestClient(schema);
        const rec = await db.plainJson.create({ data: { data: { hello: 'world' }, data1: 'data1' } });

        // Update to JSON null
        await db.plainJson.update({
            where: { id: rec.id },
            data: { data: JsonNull },
        });
        await expect(db.plainJson.findUnique({ where: { id: rec.id } })).resolves.toMatchObject({
            data: null,
        });

        // Update to DB null
        await db.plainJson.update({
            where: { id: rec.id },
            data: { data1: DbNull },
        });
        await expect(db.plainJson.findUnique({ where: { id: rec.id } })).resolves.toMatchObject({
            data1: null,
        });

        // Update to actual object
        await db.plainJson.update({
            where: { id: rec.id },
            data: { data: { updated: 'value' }, data1: { another: 'value' } },
        });
        await expect(db.plainJson.findUnique({ where: { id: rec.id } })).resolves.toMatchObject({
            data: { updated: 'value' },
            data1: { another: 'value' },
        });
    });

    it('works with JSON arrays', async () => {
        const db = await createTestClient(
            `
model PlainJson {
    id    Int   @id @default(autoincrement())
    data  Json[]
}
`,
            { provider: 'postgresql' },
        );

        await expect(db.plainJson.create({ data: { data: [{ a: 1 }, { b: 2 }] } })).resolves.toMatchObject({
            data: [{ a: 1 }, { b: 2 }],
        });
        await expect(db.plainJson.create({ data: { data: { set: [{ a: 1 }, { b: 2 }] } } })).resolves.toMatchObject({
            data: [{ a: 1 }, { b: 2 }],
        });
        await expect(db.plainJson.create({ data: { data: DbNull } })).toBeRejectedByValidation();
    });
});
