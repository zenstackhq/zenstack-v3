import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #689', () => {
    it('verifies issue 689', async () => {
        const db = await createPolicyTestClient(
            `
            model UserRole {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
                role String

                @@allow('all', true)
            }
        
            model User {
                id Int @id @default(autoincrement())
                userRole UserRole[]
                deleted Boolean @default(false)

                @@allow('create,read', true)
                @@allow('read', auth() == this)
                @@allow('read', userRole?[user == auth() && 'Admin' == role])
                @@allow('read', userRole?[user == auth()])
            }        
            `,
        );

        const rawDb = db.$unuseAll();

        await rawDb.user.create({
            data: {
                id: 1,
                userRole: {
                    create: [
                        { id: 1, role: 'Admin' },
                        { id: 2, role: 'Student' },
                    ],
                },
            },
        });

        await rawDb.user.create({
            data: {
                id: 2,
                userRole: {
                    connect: { id: 1 },
                },
            },
        });

        const c1 = await rawDb.user.count({
            where: {
                userRole: {
                    some: { role: 'Student' },
                },
                NOT: { deleted: true },
            },
        });

        const c2 = await db.user.count({
            where: {
                userRole: {
                    some: { role: 'Student' },
                },
                NOT: { deleted: true },
            },
        });

        expect(c1).toEqual(c2);
    });
});
