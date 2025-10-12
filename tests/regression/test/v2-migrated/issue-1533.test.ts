import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: JSON null support
it.skip('verifies issue 1533', async () => {
    const db = await createTestClient(
        `
model Test {
    id       String @id @default(uuid()) @db.Uuid
    metadata Json
    @@allow('all', true)
}
            `,
    );

    const testWithMetadata = await db.test.create({
        data: {
            metadata: {
                test: 'test',
            },
        },
    });
    const testWithEmptyMetadata = await db.test.create({
        data: {
            metadata: {},
        },
    });

    let result = await db.test.findMany({
        where: {
            metadata: {
                path: ['test'],
                // @ts-expect-error
                equals: Prisma.DbNull,
            },
        },
    });

    expect(result).toHaveLength(1);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: testWithEmptyMetadata.id })]));

    result = await db.test.findMany({
        where: {
            metadata: {
                path: ['test'],
                equals: 'test',
            },
        },
    });

    expect(result).toHaveLength(1);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: testWithMetadata.id })]));
});
