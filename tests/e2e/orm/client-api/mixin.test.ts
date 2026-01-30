import { describe, expect, it } from 'vitest';
import { createTestClient } from '@zenstackhq/testtools';

describe('Mixin tests', () => {
    it('includes fields and attributes from mixins', async () => {
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
        ).rejects.toThrow(/invalid/i);

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
        ).rejects.toSatisfy((e) => e.cause.message.toLowerCase().match(/(constraint)|(duplicate)/i));
    });

    it('supports multiple-level mixins', async () => {
        const schema = `
        type Base1 {
            id    String @id @default(cuid())
        }

        type Base2 with Base1 {
            fieldA String
        }
          
        model A with Base2 {
            field String
            b B[]
        }

        model B {
            id    String @id @default(cuid())
            a     A @relation(fields: [aId], references: [id])
            aId   String
          }
        `;

        const client = await createTestClient(schema);
        await expect(
            client.b.create({
                data: {
                    a: {
                        create: {
                            field: 'test',
                            fieldA: 'testA',
                        },
                    },
                },
                include: { a: true },
            }),
        ).resolves.toMatchObject({
            a: {
                id: expect.any(String),
                field: 'test',
                fieldA: 'testA',
            },
        });
    });

    it('works with multiple id fields from base', async () => {
        const schema = `
        type Base {
            id1 String
            id2 String
            value String
            @@id([id1, id2])
        }

        model Item with Base {
            x String
        }
        `;

        const client = await createTestClient(schema);
        await expect(
            client.item.create({
                data: { id1: '1', id2: '2', value: 'test', x: 'x' },
            }),
        ).resolves.toMatchObject({
            id1: '1',
            id2: '2',
        });
    });
});
