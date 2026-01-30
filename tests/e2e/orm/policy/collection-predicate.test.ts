import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Collection Predicate Tests', () => {
    it('should support collection predicates without binding', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                @@allow('create', true)
                @@allow('read', memberships?[tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: { id: 1, memberships: { create: [{ id: 1, tenantId: 1 }] } },
        });
        await db.$unuseAll().user.create({
            data: { id: 2, memberships: { create: [{ id: 2, tenantId: 1 }] } },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support referencing binding', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                @@allow('create', true)
                @@allow('read', memberships?[m, m.tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: { id: 1, memberships: { create: [{ id: 1, tenantId: 1 }] } },
        });
        await db.$unuseAll().user.create({
            data: { id: 2, memberships: { create: [{ id: 2, tenantId: 1 }] } },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support mixing bound and unbound syntax', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                @@allow('create', true)
                @@allow('read', memberships?[m, m.tenantId == id && tenantId == id])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: { id: 1, memberships: { create: [{ id: 1, tenantId: 1 }] } },
        });
        await db.$unuseAll().user.create({
            data: { id: 2, memberships: { create: [{ id: 2, tenantId: 1 }] } },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should allow disambiguation with this', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                tenantId Int
                @@allow('create', true)
                @@allow('read', memberships?[m, m.tenantId == this.tenantId])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: { id: 1, tenantId: 1, memberships: { create: [{ id: 1, tenantId: 1 }] } },
        });
        await db.$unuseAll().user.create({
            data: { id: 2, tenantId: 2, memberships: { create: [{ id: 2, tenantId: 1 }] } },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support accessing binding from deep context - case 1', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                @@allow('create', true)
                @@allow('read', memberships?[m, roles?[tenantId == m.tenantId]])
            }

            model Membership {
                id Int @id
                user User @relation(fields: [userId], references: [id])
                userId Int
                tenantId Int
                roles Role[]
                @@allow('all', true)
            }

            model Role {
                id Int @id
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                tenantId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                memberships: { create: [{ id: 1, tenantId: 1, roles: { create: { id: 1, tenantId: 1 } } }] },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                memberships: { create: [{ id: 2, tenantId: 2, roles: { create: { id: 2, tenantId: 1 } } }] },
            },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support accessing binding from deep context - case 2', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                tenantId Int
                @@allow('create', true)
                @@allow('read', memberships?[m, roles?[this.tenantId == m.tenantId]])
            }

            model Membership {
                id Int @id
                user User @relation(fields: [userId], references: [id])
                userId Int
                tenantId Int
                roles Role[]
                @@allow('all', true)
            }

            model Role {
                id Int @id
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                tenantId: 1,
                memberships: { create: [{ id: 1, tenantId: 1, roles: { create: { id: 1 } } }] },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                tenantId: 2,
                memberships: { create: [{ id: 2, tenantId: 1, roles: { create: { id: 2 } } }] },
            },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support accessing to-one relation from binding', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                tenants Tenant[]
                @@allow('create', true)
                @@allow('read', memberships?[m, m.tenant.ownerId == id])
            }

            model Tenant {
                id Int @id
                ownerId Int
                owner User @relation(fields: [ownerId], references: [id])
                memberships Membership[]
                @@allow('all', true)
            }

            model Membership {
                id Int @id
                tenant Tenant @relation(fields: [tenantId], references: [id])
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                memberships: {
                    create: [{ id: 1, tenant: { create: { id: 1, ownerId: 1 } } }],
                },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                memberships: {
                    create: [{ id: 2, tenant: { create: { id: 2, ownerId: 1 } } }],
                },
            },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should support multiple bindings in nested predicates', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                @@allow('create', true)
                @@allow('read', memberships?[m, m.roles?[r, r.tenantId == m.tenantId]])
            }

            model Membership {
                id Int @id
                tenantId Int
                user User @relation(fields: [userId], references: [id])
                userId Int
                roles Role[]
                @@allow('all', true)
            }

            model Role {
                id Int @id
                tenantId Int
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                memberships: {
                    create: [{ id: 1, tenantId: 1, roles: { create: { id: 1, tenantId: 1 } } }],
                },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                memberships: {
                    create: [{ id: 2, tenantId: 2, roles: { create: { id: 2, tenantId: 1 } } }],
                },
            },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should work with inner binding masking outer binding names', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                memberships Membership[]
                tenantId Int
                @@allow('create', true)
                @@allow('read', memberships?[m, m.roles?[m, m.tenantId == this.tenantId]])
            }

            model Membership {
                id Int @id
                user User @relation(fields: [userId], references: [id])
                userId Int
                roles Role[]
                @@allow('all', true)
            }

            model Role {
                id Int @id
                tenantId Int
                membership Membership @relation(fields: [membershipId], references: [id])
                membershipId Int
                @@allow('all', true)
            }
`,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                tenantId: 1,
                memberships: { create: [{ id: 1, roles: { create: { id: 1, tenantId: 1 } } }] },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                tenantId: 2,
                memberships: { create: [{ id: 2, roles: { create: { id: 2, tenantId: 1 } } }] },
            },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
    });

    it('should work with bindings with auth collection predicates', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                companies Company[]
                test Int

                @@allow('read', auth().companies?[c, c.staff?[s, s.companyId == this.test]])
            }

            model Company {
                id Int @id
                user User @relation(fields: [userId], references: [id])
                userId Int

                staff Staff[]
                @@allow('read', true)
            }

            model Staff {
                id Int @id

                company Company @relation(fields: [companyId], references: [id])
                companyId Int

                @@allow('read', true)
              }
            `,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                test: 1,
                companies: { create: { id: 1, staff: { create: { id: 1 } } } },
            },
        });

        await expect(
            db
                .$setAuth({ id: 1, companies: [{ id: 1, staff: [{ id: 1, companyId: 1 }] }], test: 1 })
                .user.findUnique({ where: { id: 1 } }),
        ).toResolveTruthy();
    });

    it('should work with bindings with auth collection predicates - pure value', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                companies Company[]

                @@allow('read', auth().companies?[c, c.staff?[s, s.companyId == c.id]])
            }

            model Company {
                id Int @id
                user User @relation(fields: [userId], references: [id])
                userId Int

                staff Staff[]
                @@allow('read', true)
            }

            model Staff {
                id Int @id

                company Company @relation(fields: [companyId], references: [id])
                companyId Int

                @@allow('read', true)
              }
            `,
        );
        await db.$unuseAll().user.create({
            data: {
                id: 1,
                companies: { create: { id: 1, staff: { create: { id: 1 } } } },
            },
        });

        await expect(
            db
                .$setAuth({ id: 1, companies: [{ id: 1, staff: [{ id: 1, companyId: 1 }] }] })
                .user.findUnique({ where: { id: 1 } }),
        ).toResolveTruthy();
        await expect(
            db
                .$setAuth({ id: 1, companies: [{ id: 1, staff: [{ id: 1, companyId: 2 }] }] })
                .user.findUnique({ where: { id: 1 } }),
        ).toResolveNull();
    });
});
