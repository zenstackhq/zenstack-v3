import { describe, it, expect } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('currentModel tests', () => {
    it('works in models', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel() == 'User')
            }

            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel() == 'User')
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
                @@allow('create', currentModel('upper') == 'USER')
            }

            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('upper') == 'Post')
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

    it('works with lower case', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('lower') == 'user')
            }

            model Post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('lower') == 'Post')
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

    it('works with capitalization', async () => {
        const db = await createPolicyTestClient(
            `
            model user {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('capitalize') == 'User')
            }

            model post {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('capitalize') == 'post')
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
            model USER {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('uncapitalize') == 'uSER')
            }

            model POST {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel('uncapitalize') == 'POST')
            }
            `,
        );

        await expect(db.USER.create({ data: { id: 1 } })).toResolveTruthy();

        if (db.$schema.provider.type !== 'mysql') {
            await expect(db.POST.create({ data: { id: 1 } })).toBeRejectedByPolicy();
        } else {
            // mysql string comparison is case insensitive by default
            await expect(db.POST.create({ data: { id: 1 } })).toResolveTruthy();
        }
    });

    it('works when inherited from abstract base', async () => {
        const db = await createPolicyTestClient(
            `
            type Base {
                id Int @id
                @@allow('read', true)
                @@allow('create', currentModel() == 'User')
            }

            model User with Base {
            }

            model Post with Base {
            }
            `,
        );

        await expect(db.user.create({ data: { id: 1 } })).toResolveTruthy();
        await expect(db.post.create({ data: { id: 1 } })).toBeRejectedByPolicy();
    });

    // TODO: delegate support
    it.skip('works when inherited from delegate base', async () => {
        const db = await createPolicyTestClient(
            `
            model Base {
                id Int @id
                type String
                @@delegate(type)

                @@allow('read', true)
                @@allow('create', currentModel() == 'User')
            }

            model User extends Base {
            }

            model Post extends Base {
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
                id String @id @default(currentModel())
            }
            `,
            ),
        ).rejects.toThrow('function "currentModel" is not allowed in the current context: DefaultValue');
    });

    it('complains when casing argument is invalid', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id String @id
                @@allow('create', currentModel('foo') == 'User')
            }
            `,
            ),
        ).rejects.toThrow('argument must be one of: "original", "upper", "lower", "capitalize", "uncapitalize"');
    });
});
