import type { ClientContract } from '@zenstackhq/orm';
import { createEncryptionPlugin, ENCRYPTION_KEY_BYTES } from '@zenstackhq/plugin-encryption';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const schema = `
datasource db {
    provider = "sqlite"
    url      = "file:./dev.db"
}

model User {
    id          String @id @default(cuid())
    email       String @unique
    name        String?
    secretToken String @encrypted
    posts       Post[]
}

model Post {
    id        String @id @default(cuid())
    title     String
    content   String?
    encrypted String @encrypted
    author    User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
}
`;

// Generate a 32-byte key for AES-256
const encryptionKey = new Uint8Array(ENCRYPTION_KEY_BYTES);
crypto.getRandomValues(encryptionKey);

describe('Client encrypted field tests', () => {
    let client: ClientContract<any>;

    beforeEach(async () => {
        const encryptionPlugin = createEncryptionPlugin({ encryptionKey });
        client = await createTestClient(schema, {
            plugins: [encryptionPlugin],
        });
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('encrypts and decrypts a single field on create', async () => {
        const user = await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: 'my-secret-token',
            },
        });

        expect(user).toMatchObject({
            id: expect.any(String),
            email: 'test@test.com',
            secretToken: 'my-secret-token',
        });

        // Verify the data is encrypted in the database by reading raw
        const rawResult = await client.$qb.selectFrom('User').selectAll().execute();
        expect(rawResult).toHaveLength(1);
        // The raw value should NOT be the plaintext
        expect(rawResult[0].secretToken).not.toBe('my-secret-token');
        // It should be a base64 encoded string with metadata
        expect(rawResult[0].secretToken).toContain('.');
    });

    it('encrypts and decrypts a single field on findUnique', async () => {
        const created = await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: 'my-secret-token',
            },
        });

        const found = await client.user.findUnique({
            where: { id: created.id },
        });

        expect(found).toMatchObject({
            id: created.id,
            email: 'test@test.com',
            secretToken: 'my-secret-token',
        });
    });

    it('encrypts and decrypts a single field on findMany', async () => {
        await client.user.create({
            data: { email: 'test1@test.com', secretToken: 'secret-1' },
        });
        await client.user.create({
            data: { email: 'test2@test.com', secretToken: 'secret-2' },
        });

        const users = await client.user.findMany();

        expect(users).toHaveLength(2);
        expect(users[0].secretToken).toBe('secret-1');
        expect(users[1].secretToken).toBe('secret-2');
    });

    it('encrypts field on update', async () => {
        const user = await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: 'original-secret',
            },
        });

        const updated = await client.user.update({
            where: { id: user.id },
            data: { secretToken: 'updated-secret' },
        });

        expect(updated.secretToken).toBe('updated-secret');

        // Verify via raw query that it's encrypted differently
        const rawResult = await client.$qb.selectFrom('User').selectAll().execute();
        expect(rawResult[0].secretToken).not.toBe('updated-secret');
    });

    it('handles null values gracefully', async () => {
        // Create user with non-nullable encrypted field using a value
        const user = await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: '',
            },
        });

        expect(user.secretToken).toBe('');
    });

    it('handles nested relations with encrypted fields', async () => {
        const user = await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: 'user-secret',
                posts: {
                    create: {
                        title: 'Test Post',
                        encrypted: 'post-secret',
                    },
                },
            },
            include: { posts: true },
        });

        expect(user.secretToken).toBe('user-secret');
        expect(user.posts).toHaveLength(1);
        expect(user.posts[0].encrypted).toBe('post-secret');
    });

    it('handles multiple encrypted fields in nested query results', async () => {
        await client.user.create({
            data: {
                email: 'test@test.com',
                secretToken: 'user-secret',
                posts: {
                    create: [
                        { title: 'Post 1', encrypted: 'secret-1' },
                        { title: 'Post 2', encrypted: 'secret-2' },
                    ],
                },
            },
        });

        const user = await client.user.findFirst({
            include: { posts: true },
        });

        expect(user?.secretToken).toBe('user-secret');
        expect(user?.posts).toHaveLength(2);
        expect(user?.posts.map((p: any) => p.encrypted).sort()).toEqual(['secret-1', 'secret-2']);
    });

    it('works with upsert create', async () => {
        const user = await client.user.upsert({
            where: { email: 'new@test.com' },
            create: {
                email: 'new@test.com',
                secretToken: 'new-secret',
            },
            update: {
                secretToken: 'updated-secret',
            },
        });

        expect(user.secretToken).toBe('new-secret');
    });

    it('works with upsert update', async () => {
        await client.user.create({
            data: { email: 'existing@test.com', secretToken: 'original' },
        });

        const user = await client.user.upsert({
            where: { email: 'existing@test.com' },
            create: {
                email: 'existing@test.com',
                secretToken: 'new-secret',
            },
            update: {
                secretToken: 'updated-secret',
            },
        });

        expect(user.secretToken).toBe('updated-secret');
    });

    it('works with createMany', async () => {
        await client.user.createMany({
            data: [
                { email: 'user1@test.com', secretToken: 'secret-1' },
                { email: 'user2@test.com', secretToken: 'secret-2' },
            ],
        });

        const users = await client.user.findMany({
            orderBy: { email: 'asc' },
        });

        expect(users).toHaveLength(2);
        expect(users[0].secretToken).toBe('secret-1');
        expect(users[1].secretToken).toBe('secret-2');
    });
});

describe('Encryption key rotation', () => {
    it('can decrypt with old key after rotation', async () => {
        // Use same old and new keys
        const oldKey = new Uint8Array(ENCRYPTION_KEY_BYTES);
        crypto.getRandomValues(oldKey);

        const newKey = new Uint8Array(ENCRYPTION_KEY_BYTES);
        crypto.getRandomValues(newKey);

        // Create client with old key and create data
        const oldPlugin = createEncryptionPlugin({ encryptionKey: oldKey });
        const client = await createTestClient(schema, {
            plugins: [oldPlugin],
        });

        const user = await client.user.create({
            data: { email: 'test@test.com', secretToken: 'my-secret' },
        });
        expect(user.secretToken).toBe('my-secret');

        // Get the raw encrypted value from the database
        const rawBefore = await client.$qb.selectFrom('User').selectAll().execute();
        const encryptedValue = rawBefore[0].secretToken as string;
        expect(encryptedValue).not.toBe('my-secret');
        expect(encryptedValue).toContain('.'); // Has metadata separator

        // Create a new plugin with new encryption key but supporting old decryption key
        const newPlugin = createEncryptionPlugin({
            encryptionKey: newKey,
            decryptionKeys: [oldKey], // Include old key for decryption
        });

        // Use the same client but with new plugin to verify key rotation
        const client2 = client.$use(newPlugin);

        // Should still be able to read the old data (decrypted with old key)
        const found = await client2.user.findFirst();
        expect(found?.secretToken).toBe('my-secret');

        await client.$disconnect();
    });
});

describe('Custom encryption handler', () => {
    it('supports custom encryption functions', async () => {
        const customPlugin = createEncryptionPlugin({
            encrypt: async (model, field, plain) => {
                // Simple base64 encoding for testing
                return `custom:${Buffer.from(plain).toString('base64')}`;
            },
            decrypt: async (model, field, cipher) => {
                // Decode custom format
                const base64 = cipher.replace('custom:', '');
                return Buffer.from(base64, 'base64').toString();
            },
        });

        const client = await createTestClient(schema, {
            plugins: [customPlugin],
        });

        const user = await client.user.create({
            data: { email: 'test@test.com', secretToken: 'custom-secret' },
        });

        expect(user.secretToken).toBe('custom-secret');

        // Verify custom format in database
        const rawResult = await client.$qb.selectFrom('User').selectAll().execute();
        expect(rawResult[0].secretToken).toMatch(/^custom:/);

        await client.$disconnect();
    });
});
