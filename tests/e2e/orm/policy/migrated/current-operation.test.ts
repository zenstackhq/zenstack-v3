import { describe, it, expect } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('currentOperation tests', () => {
    it('works with specific rules', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation() == 'create')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation() == 'read')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    it('works with all rule', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('all', currentOperation() == 'create')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation() == 'read')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    it('works with upper case', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('upper') == 'CREATE')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('upper') == 'READ')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    it('works with lower case', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('lower') == 'create')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('lower') == 'read')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    it('works with capitalization', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('capitalize') == 'Create')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('capitalize') == 'create')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();

        if (db.$schema.provider.type !== 'mysql') {
            await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
        } else {
            // mysql string comparison is case insensitive by default
            await expect(db.post.create({ data: { id: 1 } })).toResolveTruthy();
        }
    });

    it('works with uncapitalization', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('uncapitalize') == 'create')
            }
            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentOperation('uncapitalize') == 'read')
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    it('complains when used outside policies', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id String @id @default(currentOperation())
            }
            `,
            ),
        ).rejects.toThrow('function "currentOperation" is not allowed in the current context: DefaultValue');
    });

    it('complains when casing argument is invalid', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id String @id
                @@allow('create', currentOperation('foo') == 'User')
            }
            `,
            ),
        ).rejects.toThrow('argument must be one of: "original", "upper", "lower", "capitalize", "uncapitalize"');
    });
});
