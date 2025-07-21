import { describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

describe('Client API Mixins', () => {
    const schema = `
type TimeStamped {
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}

type Named {
    name String
    @@unique([name])
}

type CommonFields with TimeStamped Named {
    id String @id @default(cuid())
}

model Foo with TimeStamped {
    id String @id @default(cuid())
    title String
}

model Bar with CommonFields {
    description String
}
    `;

    it('includes fields and attributes from mixins', async () => {
        const client = await createTestClient(schema, {
            usePrismaPush: true,
        });

        await expect(
            client.foo.create({
                data: {
                    title: 'Foo',
                },
            }),
        ).resolves.toMatchObject({
            id: expect.any(String),
            title: 'Foo',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });

        await expect(
            client.bar.create({
                data: {
                    description: 'Bar',
                },
            }),
        ).rejects.toThrow('Invalid input');

        await expect(
            client.bar.create({
                data: {
                    name: 'Bar',
                    description: 'Bar',
                },
            }),
        ).resolves.toMatchObject({
            id: expect.any(String),
            name: 'Bar',
            description: 'Bar',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });

        await expect(
            client.bar.create({
                data: {
                    name: 'Bar',
                    description: 'Bar',
                },
            }),
        ).rejects.toThrow('constraint failed');
    });
});
