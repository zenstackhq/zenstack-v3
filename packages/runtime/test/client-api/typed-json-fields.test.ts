import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

const PG_DB_NAME = 'client-api-typed-json-fields-tests';

describe.each([{ provider: 'sqlite' as const }, { provider: 'postgresql' as const }])(
    'Typed JSON fields',
    ({ provider }) => {
        const schema = `
type Identity {
    providers IdentityProvider[]
}

type IdentityProvider {
    id   String
    name String?
}

model User {
    id        Int       @id @default(autoincrement())
    identity  Identity? @json
}
    `;

        let client: any;

        beforeEach(async () => {
            client = await createTestClient(schema, {
                usePrismaPush: true,
                provider,
                dbName: provider === 'postgresql' ? PG_DB_NAME : undefined,
                log: ['query'],
            });
        });

        afterEach(async () => {
            await client?.$disconnect();
        });

        it('works with create', async () => {
            await expect(
                client.user.create({
                    data: {},
                }),
            ).resolves.toMatchObject({
                identity: null,
            });

            await expect(
                client.user.create({
                    data: {
                        identity: {
                            providers: [
                                {
                                    id: '123',
                                    name: 'Google',
                                },
                            ],
                        },
                    },
                }),
            ).resolves.toMatchObject({
                identity: {
                    providers: [
                        {
                            id: '123',
                            name: 'Google',
                        },
                    ],
                },
            });

            await expect(
                client.user.create({
                    data: {
                        identity: {
                            providers: [
                                {
                                    id: '123',
                                },
                            ],
                        },
                    },
                }),
            ).resolves.toMatchObject({
                identity: {
                    providers: [
                        {
                            id: '123',
                        },
                    ],
                },
            });

            await expect(
                client.user.create({
                    data: {
                        identity: {
                            providers: [
                                {
                                    id: '123',
                                    foo: 1,
                                },
                            ],
                        },
                    },
                }),
            ).resolves.toMatchObject({
                identity: {
                    providers: [
                        {
                            id: '123',
                            foo: 1,
                        },
                    ],
                },
            });

            await expect(
                client.user.create({
                    data: {
                        identity: {
                            providers: [
                                {
                                    name: 'Google',
                                },
                            ],
                        },
                    },
                }),
            ).rejects.toThrow('Invalid input');
        });

        it('works with find', async () => {
            await expect(
                client.user.create({
                    data: { id: 1 },
                }),
            ).toResolveTruthy();
            await expect(client.user.findUnique({ where: { id: 1 } })).resolves.toMatchObject({
                identity: null,
            });

            await expect(
                client.user.create({
                    data: {
                        id: 2,
                        identity: {
                            providers: [
                                {
                                    id: '123',
                                    name: 'Google',
                                },
                            ],
                        },
                    },
                }),
            ).toResolveTruthy();

            await expect(client.user.findUnique({ where: { id: 2 } })).resolves.toMatchObject({
                identity: {
                    providers: [
                        {
                            id: '123',
                            name: 'Google',
                        },
                    ],
                },
            });
        });

        it('works with update', async () => {
            await expect(
                client.user.create({
                    data: { id: 1 },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        identity: {
                            providers: [
                                {
                                    id: '123',
                                    name: 'Google',
                                    foo: 1,
                                },
                            ],
                        },
                    },
                }),
            ).resolves.toMatchObject({
                identity: {
                    providers: [
                        {
                            id: '123',
                            name: 'Google',
                            foo: 1,
                        },
                    ],
                },
            });

            await expect(
                client.user.update({
                    where: { id: 1 },
                    data: {
                        identity: {
                            providers: [
                                {
                                    name: 'GitHub',
                                },
                            ],
                        },
                    },
                }),
            ).rejects.toThrow('Invalid input');
        });
    },
);
