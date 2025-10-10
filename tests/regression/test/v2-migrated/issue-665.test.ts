import { createPolicyTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: field-level policy support
it.skip('verifies issue 665', async () => {
    const db = await createPolicyTestClient(
        `
model User {
    id Int @id @default(autoincrement())
    admin Boolean @default(false)
    username String @unique @allow("all", auth() == this) @allow("all", auth().admin)
    password String @password @default("") @allow("all", auth() == this) @allow("all", auth().admin)
    firstName String @default("")
    lastName String @default("")
    
    @@allow('all', true)
}
            `,
    );

    await db.$unuseAll().user.create({ data: { id: 1, username: 'test', password: 'test', admin: true } });

    // admin
    let r = await db.$setAuth({ id: 1, admin: true }).user.findFirst();
    expect(r.username).toEqual('test');

    // owner
    r = await db.$setAuth({ id: 1 }).user.findFirst();
    expect(r.username).toEqual('test');

    // anonymous
    r = await db.$setAuth({ id: 0 }).user.findFirst();
    expect(r.username).toBeUndefined();

    // non-owner
    r = await db.$setAuth({ id: 2 }).user.findFirst();
    expect(r.username).toBeUndefined();
});
