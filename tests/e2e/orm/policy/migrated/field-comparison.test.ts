import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('field comparison tests', () => {
    it('works with policies involving field comparison', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x Int
            y Int

            @@allow('create', x > y)
            @@allow('read', true)
        }
        `,
        );

        await expect(db.model.create({ data: { x: 1, y: 2 } })).toBeRejectedByPolicy();
        await expect(db.model.create({ data: { x: 2, y: 1 } })).toResolveTruthy();
    });

    it('works with "in" operator', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x String
            y String[]
            @@allow('create', x in y)
            @@allow('read', x in y)
        }
        `,
            {
                provider: 'postgresql',
                dbName: 'field-comparison-tests-operator',
            },
        );

        try {
            await expect(db.model.create({ data: { x: 'a', y: ['b', 'c'] } })).toBeRejectedByPolicy();
            await expect(db.model.create({ data: { x: 'a', y: ['a', 'c'] } })).toResolveTruthy();
        } finally {
            await db.$disconnect();
        }
    });

    it('field in operator success with policy check', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            x String @default('x')
            y String[]
            @@allow('create', x in y)
            @@allow('read', x in y)
        }
        `,
            {
                provider: 'postgresql',
                dbName: 'field-comparison-tests-operator-2',
            },
        );

        try {
            await expect(db.model.create({ data: { x: 'a', y: ['b', 'c'] } })).toBeRejectedByPolicy();
            await expect(db.model.create({ data: { x: 'a', y: ['a', 'c'] } })).toResolveTruthy();
        } finally {
            await db.$disconnect();
        }
    });

    it('field comparison type error', async () => {
        await expect(
            createPolicyTestClient(
                `
        model Model {
            id String @id @default(uuid())
            x Int
            y String

            @@allow('create', x > y)
            @@allow('read', true)
        }
        `,
            ),
        ).rejects.toThrow(/invalid operand type/);
    });
});
