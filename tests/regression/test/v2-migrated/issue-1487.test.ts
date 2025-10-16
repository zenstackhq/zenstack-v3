import { createTestClient } from '@zenstackhq/testtools';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1487', () => {
    it('verifies issue 1487', async () => {
        const db = await createTestClient(
            `
model LineItem {
    id Int @id @default(autoincrement())
    price Decimal
    createdAt DateTime @default(now())

    orderId Int
    order Order @relation(fields: [orderId], references: [id])
}
model Order extends BaseType {
    total Decimal
    createdAt DateTime @default(now())
    lineItems LineItem[]
}
model BaseType {
    id Int @id @default(autoincrement())
    entityType String

    @@delegate(entityType)
}
                `,
        );

        const create = await db.Order.create({
            data: {
                total: new Decimal(100_100.99),
                lineItems: { create: [{ price: 90_000.66 }, { price: 20_100.33 }] },
            },
        });

        const order = await db.Order.findFirst({ where: { id: create.id }, include: { lineItems: true } });
        expect(Decimal.isDecimal(order.total)).toBe(true);
        expect(order.createdAt instanceof Date).toBe(true);
        expect(order.total.toString()).toEqual('100100.99');
        order.lineItems.forEach((item: any) => {
            expect(Decimal.isDecimal(item.price)).toBe(true);
            expect(item.price.toString()).not.toEqual('[object Object]');
        });

        const lineItems = await db.LineItem.findMany();
        lineItems.forEach((item: any) => {
            expect(item.createdAt instanceof Date).toBe(true);
            expect(Decimal.isDecimal(item.price)).toBe(true);
            expect(item.price.toString()).not.toEqual('[object Object]');
        });
    });
});
