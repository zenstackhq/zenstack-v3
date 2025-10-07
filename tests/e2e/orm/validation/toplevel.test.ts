import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Toplevel field validation tests', () => {
    it('works with string fields', async () => {
        const db = await createTestClient(`
        model Foo {
            id Int @id @default(autoincrement())
            str1 String? @length(2, 4) @startsWith('a') @endsWith('b') @contains('m') @regex('b{2}')
            str2 String? @email
            str3 String? @datetime
            str4 String? @url
            str5 String? @trim @lower
            str6 String? @upper
        }
        `);

        await db.foo.create({ data: { id: 1 } });

        for (const action of ['create', 'update', 'upsert', 'updateMany']) {
            const _t =
                action === 'create'
                    ? (data: any) => db.foo.create({ data })
                    : action === 'update'
                      ? (data: any) => db.foo.update({ where: { id: 1 }, data })
                      : action === 'upsert'
                        ? (data: any) => db.foo.upsert({ where: { id: 1 }, create: data, update: data })
                        : (data: any) => db.foo.updateMany({ where: { id: 1 }, data });

            // violates @length min
            await expect(_t({ str1: 'a' })).toBeRejectedByValidation();

            // violates @length max
            await expect(_t({ str1: 'abcde' })).toBeRejectedByValidation();

            // violates @startsWith
            await expect(_t({ str1: 'bcd' })).toBeRejectedByValidation();

            // violates @endsWith
            await expect(_t({ str1: 'abc' })).toBeRejectedByValidation();

            // violates @contains
            await expect(_t({ str1: 'abz' })).toBeRejectedByValidation();

            // violates @regex
            await expect(_t({ str1: 'amcb' })).toBeRejectedByValidation();

            // satisfies all
            await expect(_t({ str1: 'ambb' })).toResolveTruthy();

            // violates @email
            await expect(_t({ str2: 'not-an-email' })).toBeRejectedByValidation(['Invalid email']);

            // satisfies @email
            await expect(_t({ str2: 'test@example.com' })).toResolveTruthy();

            // violates @datetime
            await expect(_t({ str3: 'not-datetime' })).toBeRejectedByValidation();

            // satisfies @datetime
            await expect(_t({ str3: new Date().toISOString() })).toResolveTruthy();

            // violates @url
            await expect(_t({ str4: 'not-a-url' })).toBeRejectedByValidation();

            // satisfies @url
            await expect(_t({ str4: 'https://example.com' })).toResolveTruthy();

            // test @trim and @lower
            if (action !== 'updateMany') {
                await expect(_t({ str5: '  AbC  ' })).resolves.toMatchObject({ str5: 'abc' });
            } else {
                await expect(_t({ str5: '  AbC  ' })).resolves.toMatchObject({ count: 1 });
            }

            // test @upper
            if (action !== 'updateMany') {
                await expect(_t({ str6: 'aBc' })).resolves.toMatchObject({ str6: 'ABC' });
            } else {
                await expect(_t({ str6: 'aBc' })).resolves.toMatchObject({ count: 1 });
            }
        }
    });

    it('works with number fields', async () => {
        const db = await createTestClient(`
        model Foo {
            id Int @id @default(autoincrement())
            int1 Int? @gt(2) @lt(4)
            int2 Int? @gte(2) @lte(4)
        }
        `);

        await db.foo.create({ data: { id: 1 } });

        for (const action of ['create', 'update']) {
            const _t =
                action === 'create'
                    ? (data: any) => db.foo.create({ data })
                    : (data: any) => db.foo.update({ where: { id: 1 }, data });

            // violates @gt
            await expect(_t({ int1: 1 })).toBeRejectedByValidation();

            // violates @lt
            await expect(_t({ int1: 4 })).toBeRejectedByValidation();

            // violates @gte
            await expect(_t({ int2: 1 })).toBeRejectedByValidation();

            // violates @lte
            await expect(_t({ int2: 5 })).toBeRejectedByValidation();

            // satisfies all
            await expect(_t({ int1: 3, int2: 4 })).toResolveTruthy();
        }
    });
});
