import { describe, it } from 'vitest';
import { loadSchema, loadSchemaWithError } from './utils';

describe('Expression Validation Tests', () => {
    describe('Model Comparison Tests', () => {
        it('should reject model comparison1', async () => {
            await loadSchemaWithError(
                `
            model User {
                id Int @id
                name String
                posts Post[]
            }

            model Post {
                id Int @id
                title String
                author User @relation(fields: [authorId], references: [id])
                authorId Int
                @@allow('all', author == this)
            }
        `,
                'comparison between models is not supported',
            );
        });

        it('should reject model comparison2', async () => {
            await loadSchemaWithError(
                `
            model User {
                id Int @id
                name String
                profile Profile?
                address Address?
                @@allow('read', profile == this)
            }

            model Profile {
                id Int @id
                bio String
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
            }

            model Address {
                id Int @id
                street String
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
            }
        `,
                'comparison between models is not supported',
            );
        });

        it('should allow auth comparison with auth type', async () => {
            await loadSchema(
                `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                name String
                profile Profile?
                @@allow('read', auth() == this)
            }

            model Profile {
                id Int @id
                bio String
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                @@allow('read', auth() == user)
            }
        `,
            );
        });

        it('should reject auth comparison with non-auth type', async () => {
            await loadSchemaWithError(
                `
            model User {
                id Int @id
                name String
                profile Profile?
            }

            model Profile {
                id Int @id
                bio String
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                @@allow('read', auth() == this)
            }
        `,
                'incompatible operand types',
            );
        });
    });

    describe('Collection Predicate Tests', () => {
        it('should reject standalone binding access', async () => {
            await loadSchemaWithError(
                `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[m, m != null])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
        `,
                'binding cannot be used without a member access',
            );
        });

        it('should allow referencing binding', async () => {
            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[m, m.tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
        `);
        });

        it('should keep supporting unbound collection predicate syntax', async () => {
            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
        `);
        });

        it('should support mixing bound and unbound syntax', async () => {
            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[m, m.tenantId == id && tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
        `);
        });

        it('should allow disambiguation with this', async () => {
            await loadSchema(`
                datasource db {
                    provider = 'sqlite'
                    url      = 'file:./dev.db'
                }

                model User {
                    id Int @id
                    memberships Membership[]
                    value Int
                    @@allow('read', memberships?[m, m.value == this.value])
                }

                model Membership {
                    id Int @id
                    tenantId Int
                    user User @relation(fields: [userId], references: [id])
                    userId Int
                    value Int
                }
            `);

            await loadSchemaWithError(
                `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                value String
                @@allow('read', memberships?[m, m.value == this.value])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                value Int
            }
        `,
                'incompatible operand types',
            );

            await loadSchemaWithError(
                `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                value String
                @@allow('read', memberships?[value == this.value])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                value Int
            }
        `,
                'incompatible operand types',
            );
        });

        it('should support accessing binding from deep context', async () => {
            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[m, roles?[value == m.value]])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                value  Int
                roles Role[]
            }

            model Role {
                id Int @id
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                value Int
            }
        `);

            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                @@allow('read', memberships?[m, roles?[r, r.value == m.value]])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                value  Int
                roles Role[]
            }

            model Role {
                id Int @id
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                value Int
            }
        `);

            await loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id Int @id
                memberships Membership[]
                x Int
                @@allow('read', memberships?[m, roles?[this.x == m.value]])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                value  Int
                roles Role[]
            }

            model Role {
                id Int @id
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                value Int
            }
        `);
        });
    });
});
