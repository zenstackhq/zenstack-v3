import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #811', () => {
    it('verifies issue 811', async () => {
        const db = await createPolicyTestClient(
            `
                model Membership {
                    id String @id @default(uuid())
                    role String @default('STANDARD')
                    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
                    userId String @unique
              
                    @@auth
                    @@allow('create,update,delete', auth().role == 'ADMIN')
                    @@allow('update', auth() == this)
                    @@allow('read', true)
                }
                model User {
                    id String   @id @default(uuid())
                    profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
                    profileId String @unique
                    memberships Membership[]     
              
                    @@allow('create,update,delete', auth().role == 'ADMIN')
                    @@allow('update', id == auth().userId)
                    @@allow('read', true)
                }
                model Profile {
                    id String   @id @default(uuid())
                    firstName String
                    users User[]
              
                    @@allow('create,update,delete', auth().role == 'ADMIN')
                    @@allow('update', users?[id == auth().userId])
                    @@allow('read', true)
                }
                `,
        );

        const r = await db.$unuseAll().user.create({
            data: {
                profile: {
                    create: { firstName: 'Tom' },
                },
                memberships: {
                    create: { role: 'STANDARD' },
                },
            },
            include: {
                profile: true,
                memberships: true,
            },
        });

        const membershipId = r.memberships[0].id;
        const userId = r.id;
        const authDb = db.$setAuth({ id: membershipId, role: 'ADMIN', userId });

        const r1 = await authDb.membership.update({
            data: {
                role: 'VIP',
                user: { update: { data: { profile: { update: { data: { firstName: 'Jerry' } } } } } },
            },
            include: { user: { include: { profile: true } } },
            where: { id: membershipId },
        });

        expect(r1.role).toBe('VIP');
        expect(r1.user.profile.firstName).toBe('Jerry');
    });
});
