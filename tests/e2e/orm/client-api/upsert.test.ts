import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('Client upsert tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel upsert', async () => {
        // create
        await expect(
            client.user.upsert({
                where: { id: '1' },
                create: {
                    id: '1',
                    email: 'u1@test.com',
                    name: 'New',
                    profile: { create: { bio: 'My bio' } },
                },
                update: { name: 'Foo' },
                include: { profile: true },
            }),
        ).resolves.toMatchObject({
            id: '1',
            name: 'New',
            profile: { bio: 'My bio' },
        });

        // update
        const r = await client.user.upsert({
            where: { id: '1' },
            create: {
                id: '2',
                email: 'u2@test.com',
                name: 'New',
            },
            update: { name: 'Updated' },
            select: { id: true, name: true },
        });
        expect(r).toMatchObject({
            id: '1',
            name: 'Updated',
        });
        // @ts-expect-error
        expect(r.email).toBeUndefined();

        // id update
        await expect(
            client.user.upsert({
                where: { id: '1' },
                create: {
                    id: '2',
                    email: 'u2@test.com',
                    name: 'New',
                },
                update: { id: '3' },
            }),
        ).resolves.toMatchObject({
            id: '3',
            name: 'Updated',
            email: 'u1@test.com',
        });
    });

    it('works with upsert with empty update payload', async () => {
        // Test 1: Upsert with empty update should create new record when it doesn't exist
        const created = await client.user.upsert({
            where: { id: '1' },
            create: {
                id: '1',
                email: 'u1@test.com',
                name: 'John',
            },
            update: {},
            select: { id: true, email: true, name: true },
        });

        expect(created).toMatchObject({
            id: '1',
            email: 'u1@test.com',
            name: 'John',
        });

        // Verify the record was created
        const fetchedAfterCreate = await client.user.findUnique({
            where: { id: '1' },
            select: { id: true, email: true, name: true },
        });

        expect(fetchedAfterCreate).toMatchObject({
            id: '1',
            email: 'u1@test.com',
            name: 'John',
        });

        // Test 2: Upsert with empty update should return existing record unchanged
        const result = await client.user.upsert({
            where: { id: '1' },
            create: {
                id: '1',
                email: 'u1@test.com',
                name: 'Jane',
            },
            update: {},
            select: { id: true, email: true, name: true },
        });

        expect(result).toMatchObject({
            id: '1',
            email: 'u1@test.com',
            name: 'John', // Should remain unchanged
        });

        // Verify the record was not modified
        const fetched = await client.user.findUnique({
            where: { id: '1' },
            select: { id: true, email: true, name: true },
        });

        expect(fetched).toMatchObject({
            id: '1',
            email: 'u1@test.com',
            name: 'John',
        });
    });

    it('works with upsert with empty create payload', async () => {
        const db = await createTestClient(
            `
model User {
  id String @id @default(cuid())
  name String?
}
        `,
            { dbName: 'orm_upsert_empty_create' },
        );

        // Test 1: First upsert should create the entity with empty data
        const created = await db.user.upsert({
            where: { id: '1' },
            create: {},
            update: { name: 'Updated' },
        });

        expect(created).toBeTruthy();

        // Verify the record was created
        await expect(db.user.findFirst()).resolves.toMatchObject(created);

        // Test 2: Second upsert should update the existing entity
        const updated = await db.user.upsert({
            where: { id: created.id },
            create: {},
            update: { name: 'Updated' },
        });

        expect(updated).toMatchObject({
            id: created.id,
            name: 'Updated',
        });

        // Verify the record was updated
        await expect(
            db.user.findUnique({
                where: { id: created.id },
            }),
        ).resolves.toMatchObject({
            name: 'Updated',
        });

        await db.$disconnect();
    });
});
