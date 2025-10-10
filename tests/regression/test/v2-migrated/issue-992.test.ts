import { createPolicyTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: global omit support
it.skip('regression', async () => {
    const db = await createPolicyTestClient(
        `
model Product {
    id String @id @default(cuid())
    category Category @relation(fields: [categoryId], references: [id])
    categoryId String
    
    deleted Int @default(0) @omit
    @@deny('read', deleted != 0)
    @@allow('all', true)
}
    
model Category {
    id String @id @default(cuid())
    products Product[]
    @@allow('all', true)
}
            `,
    );

    await db.$unuseAll().category.create({
        data: {
            products: {
                create: [
                    {
                        deleted: 0,
                    },
                    {
                        deleted: 0,
                    },
                ],
            },
        },
    });

    const category = await db.category.findFirst({ include: { products: true } });
    expect(category.products[0].deleted).toBeUndefined();
    expect(category.products[1].deleted).toBeUndefined();
});
