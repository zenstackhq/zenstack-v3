import { describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

describe('Computed fields tests', () => {
    it('works with non-optional fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
            {
                computedFields: {
                    User: {
                        upperName: (eb: any) => eb.fn('upper', ['name']),
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, name: 'Alex' },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.findUnique({
                where: { id: 1 },
                select: { upperName: true },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });
    });

    it('is typed correctly for non-optional fields', async () => {
        await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        computedFields: {
            User: {
                upperName: (eb) => eb.fn('upper', ['name']),
            },
        }
    });

    const user = await client.user.create({
        data: { id: 1, name: 'Alex' }
    });
    console.log(user.upperName);
    // @ts-expect-error
    user.upperName = null;
}

main();
`,
                },
            },
        );
    });

    it('works with optional fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
            {
                computedFields: {
                    User: {
                        upperName: (eb: any) => eb.lit(null),
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, name: 'Alex' },
            }),
        ).resolves.toMatchObject({
            upperName: null,
        });
    });

    it('is typed correctly for optional fields', async () => {
        await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        computedFields: {
            User: {
                upperName: (eb) => eb.lit(null),
            },
        }
    });

    const user = await client.user.create({
        data: { id: 1, name: 'Alex' }
    });
    console.log(user.upperName);
    user.upperName = null;
}

main();
`,
                },
            },
        );
    });
});
