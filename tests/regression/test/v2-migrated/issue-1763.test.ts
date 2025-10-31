import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1763', () => {
    it('verifies issue 1763', async () => {
        await createTestClient(
            `
model Post {
    id   Int    @id @default(autoincrement())
    name String

    type String
    @@delegate(type)

    // full access by author
    @@allow('all', true)
}

model ConcretePost extends Post {
    age Int
}
            `,

            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/orm';
import { schema } from './schema';

async function test() {
    const db = new ZenStackClient(schema, {} as any);
    await db.concretePost.create({
        data: {
            id: 5,
            name: 'a name',
            age: 20,
        },
    });
}`,
                },
            },
        );
    });
});
