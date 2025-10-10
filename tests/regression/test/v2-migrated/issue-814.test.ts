import { createPolicyTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: field-level policy support
it.skip('verifies issue 814', async () => {
    const db = await createPolicyTestClient(
        `
model User {
    id    Int     @id @default(autoincrement())
    profile Profile?
    
    @@allow('all', true)
}

model Profile {
    id    Int     @id @default(autoincrement())
    name String @allow('read', !private)
    private Boolean @default(false)
    user User @relation(fields: [userId], references: [id])
    userId Int @unique

    @@allow('all', true)
}
            `,
    );

    const user = await db.$unuseAll().user.create({
        data: { profile: { create: { name: 'Foo', private: true } } },
        include: { profile: true },
    });

    const r = await db.profile.findFirst({ where: { id: user.profile.id } });
    expect(r.name).toBeUndefined();

    const r1 = await db.user.findFirst({
        where: { id: user.id },
        include: { profile: true },
    });
    expect(r1.profile.name).toBeUndefined();
});
