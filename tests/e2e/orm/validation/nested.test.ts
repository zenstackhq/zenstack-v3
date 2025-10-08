import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Nested field validation tests', () => {
    it('works with nested create/update', async () => {
        const db = await createTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
            profile Profile?
        }

        model Profile {
            id Int @id @default(autoincrement())
            email String @email
            user User @relation(fields: [userId], references: [id])
            userId Int @unique
            @@validate(contains(email, 'zenstack'), 'email must be a zenstack email')
        }
        `,
        );

        await db.user.create({ data: { id: 1 } });

        for (const action of ['create', 'update']) {
            const _t =
                action === 'create'
                    ? (data: any) => db.user.update({ where: { id: 1 }, data: { profile: { create: data } } })
                    : (data: any) => db.user.update({ where: { id: 1 }, data: { profile: { update: data } } });

            // violates email
            await expect(_t({ email: 'zenstack' })).toBeRejectedByValidation(['Invalid email']);

            // violates custom validation
            await expect(_t({ email: 'a@b.com' })).toBeRejectedByValidation(['email must be a zenstack email']);

            // satisfies all
            await expect(_t({ email: 'me@zenstack.dev' })).toResolveTruthy();
        }
    });
});
