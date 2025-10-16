import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Policy dumb rules tests', () => {
    it('works with create dumb rules', async () => {
        const db = await createPolicyTestClient(
            `
model A {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', 1 > 0)
    @@allow('read', true)
}

model B {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', 0 > 1)
    @@allow('read', true)
}

model C {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', true)
    @@allow('read', true)
}

model D {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', false)
    @@allow('read', true)
}
`,
        );
        await expect(db.a.create({ data: { x: 0 } })).resolves.toMatchObject({ x: 0 });
        await expect(db.b.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.c.create({ data: { x: 0 } })).resolves.toMatchObject({ x: 0 });
        await expect(db.d.create({ data: { x: 0 } })).toBeRejectedByPolicy();
    });
});
