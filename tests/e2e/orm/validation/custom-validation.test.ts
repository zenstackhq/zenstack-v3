import { createTestClient, loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Custom validation tests', () => {
    it('works with custom validation', async () => {
        const db = await createTestClient(
            `
        model Foo {
            id Int @id @default(autoincrement())
            str1 String?
            str2 String?
            str3 String?
            str4 String?
            str5 String?
            int1 Int?
            list1 Int[]
            list2 Int[]
            list3 Int[]

            @@validate(
                (str1 == null || (length(str1) >= 8 && length(str1) <= 10))
                && (int1 == null || (int1 > 1 && int1 < 4)),
                'invalid fields')

            @@validate(str1 == null || (startsWith(str1, 'a') && endsWith(str1, 'm') && contains(str1, 'b')), 'invalid fields')

            @@validate(str2 == null || regex(str2, '^x.*z$'), 'invalid str2')

            @@validate(str3 == null || isEmail(str3), 'invalid str3')

            @@validate(str4 == null || isUrl(str4), 'invalid str4')

            @@validate(str5 == null || isDateTime(str5), 'invalid str5')

            @@validate(list1 == null || (has(list1, 1) && hasSome(list1, [2, 3]) && hasEvery(list1, [4, 5])), 'invalid list1')

            @@validate(list2 == null || isEmpty(list2), 'invalid list2', ['x', 'y'])

            @@validate(list3 == null || length(list3) <2 , 'invalid list3')
        }
        `,
            { provider: 'postgresql' },
        );

        await db.foo.create({ data: { id: 100 } });

        for (const action of ['create', 'update']) {
            const _t =
                action === 'create'
                    ? (data: any) => db.foo.create({ data })
                    : (data: any) => db.foo.update({ where: { id: 100 }, data });
            // violates length
            await expect(_t({ str1: 'abd@efg.com' })).toBeRejectedByValidation(['invalid fields']);
            await expect(_t({ str1: 'a@b.c' })).toBeRejectedByValidation(['invalid fields']);

            // violates int1 > 1
            await expect(_t({ int1: 1 })).toBeRejectedByValidation(['invalid fields']);

            // violates startsWith
            await expect(_t({ str1: 'b@cd.com' })).toBeRejectedByValidation(['invalid fields']);

            // violates endsWith
            await expect(_t({ str1: 'a@b.gov' })).toBeRejectedByValidation(['invalid fields']);

            // violates contains
            await expect(_t({ str1: 'a@cd.com' })).toBeRejectedByValidation(['invalid fields']);

            // violates regex
            await expect(_t({ str2: 'xab' })).toBeRejectedByValidation(['invalid str2']);

            // violates email
            await expect(_t({ str3: 'not-an-email' })).toBeRejectedByValidation(['invalid str3']);

            // violates url
            await expect(_t({ str4: 'not-an-url' })).toBeRejectedByValidation(['invalid str4']);

            // violates datetime
            await expect(_t({ str5: 'not-an-datetime' })).toBeRejectedByValidation(['invalid str5']);

            // violates has
            await expect(_t({ list1: [2, 3, 4, 5] })).toBeRejectedByValidation(['invalid list1']);

            // violates hasSome
            await expect(_t({ list1: [1, 4, 5] })).toBeRejectedByValidation(['invalid list1']);

            // violates hasEvery
            await expect(_t({ list1: [1, 2, 3, 4] })).toBeRejectedByValidation(['invalid list1']);

            // violates isEmpty
            let thrown = false;
            try {
                await _t({ list2: [1] });
            } catch (err) {
                thrown = true;
                expect((err as any).cause.issues[0].path).toEqual(['data', 'x', 'y']);
            }
            expect(thrown).toBe(true);

            // validates list length
            await expect(_t({ list3: [1, 2] })).toBeRejectedByValidation(['invalid list3']);

            // satisfies all
            await expect(
                _t({
                    str1: 'ab12345m',
                    str2: 'x...z',
                    str3: 'ab@c.com',
                    str4: 'http://a.b.c',
                    str5: new Date().toISOString(),
                    int1: 2,
                    list1: [1, 2, 4, 5],
                    list2: [],
                    list3: [1],
                }),
            ).toResolveTruthy();
        }
    });

    it('allows disabling validation', async () => {
        const db = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                email String @unique @email
                @@validate(length(email) >= 8)
                @@allow('all', true)
            }
            `,
        );

        await expect(
            db.user.create({
                data: {
                    email: 'xyz',
                },
            }),
        ).toBeRejectedByValidation();
        await expect(
            db.user.create({
                data: {
                    email: 'a@b.com',
                },
            }),
        ).toBeRejectedByValidation();

        const dbNoValidation = db.$setOptions({ ...db.$options, validateInput: false });

        await expect(
            dbNoValidation.user.create({
                data: {
                    id: 1,
                    email: 'xyz',
                },
            }),
        ).toResolveTruthy();

        await expect(
            dbNoValidation.user.update({
                where: { id: 1 },
                data: {
                    email: 'a@b.com',
                },
            }),
        ).toResolveTruthy();

        // original client not affected
        await expect(
            db.user.create({
                data: {
                    email: 'xyz',
                },
            }),
        ).toBeRejectedByValidation();
        await expect(
            db.user.create({
                data: {
                    email: 'a@b.com',
                },
            }),
        ).toBeRejectedByValidation();
    });

    it('checks arg type for validation functions', async () => {
        // length() on relation field
        await loadSchemaWithError(
            `
        model Foo {
            id Int @id @default(autoincrement())
            bars Bar[]
            @@validate(length(bars) > 0)
        }

        model Bar {
            id Int @id @default(autoincrement())
            foo Foo @relation(fields: [fooId], references: [id])
            fooId Int
        }
        `,
            'argument must be a string or list field',
        );

        // length() on non-string/list field
        await loadSchemaWithError(
            `
        model Foo {
            id Int @id @default(autoincrement())
            x Int
            @@validate(length(x) > 0)
        }
        `,
            'argument must be a string or list field',
        );

        // invalid regex pattern
        await loadSchemaWithError(
            `
        model Foo {
            id Int @id @default(autoincrement())
            x String
            @@validate(regex(x, '[abc'))
        }
        `,
            'invalid regular expression',
        );

        // using field as regex pattern
        await loadSchemaWithError(
            `
        model Foo {
            id Int @id @default(autoincrement())
            x String
            y String
            @@validate(regex(x, y))
        }
        `,
            'second argument must be a string literal',
        );
    });
});
