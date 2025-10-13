import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

it('verifies issue 1894', async () => {
    const db = await createTestClient(
        `
model A {
    id Int @id @default(autoincrement())
    b  B[]
}

model B {
    id   Int    @id @default(autoincrement())
    a    A      @relation(fields: [aId], references: [id])
    aId  Int

    type String
    @@delegate(type)
}

model C extends B {
    f String?
}
            `,
        {
            extraSourceFiles: {
                main: `
        import { ZenStackClient } from '@zenstackhq/runtime';
        import { schema } from './schema';

        async function main() {
            const db = new ZenStackClient(schema, {} as any);
            await db.a.create({ data: { id: 0 } });
            await db.c.create({ data: { a: { connect: { id: 0 } } } });
        }

        main();

`,
            },
        },
    );

    await db.a.create({ data: { id: 0 } });
    await expect(db.c.create({ data: { a: { connect: { id: 0 } } } })).toResolveTruthy();
});
