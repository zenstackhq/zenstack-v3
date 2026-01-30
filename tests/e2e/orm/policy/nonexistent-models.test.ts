import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Policy tests for nonexistent models and fields', () => {
    it('rejects access to nonexistent model', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', true)
            }
            `,
        );
        const dbRaw = db.$unuseAll();

        // create a Bar table
        if (['postgresql', 'sqlite'].includes(dbRaw.$schema.provider.type)) {
            await dbRaw.$executeRawUnsafe(
                `CREATE TABLE "Bar" ("id" TEXT PRIMARY KEY, "string" TEXT, "fooId" TEXT, FOREIGN KEY ("fooId") REFERENCES "Foo" ("id"));`,
            );
        } else {
            await dbRaw.$executeRawUnsafe(
                `CREATE TABLE Bar (id VARCHAR(191) PRIMARY KEY, string VARCHAR(191), fooId VARCHAR(191), FOREIGN KEY (fooId) REFERENCES Foo (id));`,
            );
        }

        await dbRaw.$qb.insertInto('Foo').values({ id: '1', string: 'test' }).execute();
        await dbRaw.$qb.insertInto('Bar').values({ id: '1', string: 'test', fooId: '1' }).execute();

        expect(db.bar).toBeUndefined();

        // unknown relation
        await expect(db.foo.findFirst({ include: { bar: true } })).toBeRejectedByValidation();

        // read
        await expect(db.$qb.selectFrom('Bar').selectAll().execute()).toBeRejectedByPolicy();

        // join
        await expect(
            db.$qb.selectFrom('Foo').innerJoin('Bar', 'Bar.fooId', 'Foo.id').selectAll().execute(),
        ).toBeRejectedByPolicy();

        // create
        await expect(db.$qb.insertInto('Bar').values({ id: '1', string: 'test' }).execute()).toBeRejectedByPolicy();

        // update
        await expect(
            db.$qb.updateTable('Bar').set({ string: 'updated' }).where('id', '=', '1').execute(),
        ).toBeRejectedByPolicy();

        // update with from
        await expect(
            db.$qb
                .updateTable('Foo')
                .set({ string: 'updated' })
                .from('Bar')
                .where('Bar.fooId', '=', 'Foo.id')
                .execute(),
        ).toBeRejectedByPolicy();

        // delete
        await expect(db.$qb.deleteFrom('Bar').where('id', '=', '1').execute()).toBeRejectedByPolicy();
    });
});
