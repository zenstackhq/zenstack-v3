import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1506', () => {
    it('verifies issue 1506', async () => {
        await createPolicyTestClient(
            `
model A {
    id Int @id @default(autoincrement())
    value Int
    b B @relation(fields: [bId], references: [id])
    bId Int @unique

    @@allow('read', true)
}

model B {
    id Int @id @default(autoincrement())
    value Int
    a A?
    c C @relation(fields: [cId], references: [id])
    cId Int @unique

    @@allow('read', value > c.value)
}

model C {
    id Int @id @default(autoincrement())
    value Int
    b B?

    @@allow('read', true)
}
            `,
        );
    });
});
