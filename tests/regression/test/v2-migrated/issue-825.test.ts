import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #825', () => {
    it('verifies issue 825', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id    Int     @id @default(autoincrement())
        role String
    
        @@allow('read', true)
        @@allow('update', auth().id == id || auth().role == 'superadmin' || auth().role == 'admin')
        @@deny('update', 
            (role == 'superadmin' && auth().id != id) 
            || (role == 'admin' && auth().id != id && auth().role != 'superadmin'))

        @@deny('post-update', 
            (before().role != role && auth().role != 'admin' && auth().role != 'superadmin') 
            || (before().role != role && role == 'superadmin') 
            || (before().role != role && role == 'admin' && auth().role != 'superadmin'))
    }
                `,
        );

        const admin = await db.$unuseAll().user.create({
            data: { role: 'admin' },
        });

        const user = await db.$unuseAll().user.create({
            data: { role: 'customer' },
        });

        const r = await db.$setAuth(admin).user.update({
            where: { id: user.id },
            data: { role: 'staff' },
        });

        expect(r.role).toEqual('staff');
    });
});
