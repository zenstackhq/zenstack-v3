import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1994', () => {
    it('verifies issue 1994', async () => {
        const db = await createTestClient(
            `
    model OrganizationRole {
      id              Int @id @default(autoincrement())
      rolePrivileges  OrganizationRolePrivilege[]
      type            String
      @@delegate(type)
    }

    model Organization {
      id              Int @id @default(autoincrement())
      customRoles     CustomOrganizationRole[]
    }

    // roles common to all orgs, defined once
    model SystemDefinedRole extends OrganizationRole {
      name String @unique
    }

    // roles specific to each org
    model CustomOrganizationRole extends OrganizationRole {
      name String
      organizationId Int
      organization   Organization @relation(fields: [organizationId], references: [id])

      @@unique([organizationId, name])
      @@index([organizationId])
    }

    model OrganizationRolePrivilege {
      organizationRoleId Int
      privilegeId        Int

      organizationRole   OrganizationRole @relation(fields: [organizationRoleId], references: [id])
      privilege          Privilege        @relation(fields: [privilegeId], references: [id])

      @@id([organizationRoleId, privilegeId])
    }

    model Privilege {
      id                  Int @id @default(autoincrement())
      name                String // e.g. "org:manage"

      orgRolePrivileges   OrganizationRolePrivilege[]
      @@unique([name])
    }
                `,
            {
                extraSourceFiles: {
                    main: `
                            import { ZenStackClient } from '@zenstackhq/orm';
                            import { schema } from './schema';

                            const db = new ZenStackClient(schema, {} as any);
                        
                            async function main() {
                                const privilege = await db.privilege.create({
                                    data: { name: 'org:manage' },
                                });

                                await db.systemDefinedRole.create({
                                    data: {
                                        name: 'Admin',
                                        rolePrivileges: {
                                            create: [
                                                {
                                                    privilegeId: privilege.id,
                                                },
                                            ],
                                        },
                                    },
                                });
                            }
                            main()
                        `,
                },
            },
        );

        const privilege = await db.privilege.create({
            data: { name: 'org:manage' },
        });

        await expect(
            db.systemDefinedRole.create({
                data: {
                    name: 'Admin',
                    rolePrivileges: {
                        create: [
                            {
                                privilegeId: privilege.id,
                            },
                        ],
                    },
                },
            }),
        ).toResolveTruthy();
    });
});
