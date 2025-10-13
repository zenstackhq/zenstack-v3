import { createPolicyTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: field-level policy support
it.skip('verifies issue 1734', async () => {
    const db = await createPolicyTestClient(
        `
type Base {
    id        String   @id @default(cuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}

model Profile with Base {
    displayName String
    type        String

    @@allow('read', true)
    @@delegate(type)
}

model User extends Profile {
    username     String         @unique
    access       Access[]
    organization Organization[]
}

model Access with Base {
    user           User         @relation(fields: [userId], references: [id])
    userId         String

    organization   Organization @relation(fields: [organizationId], references: [id])
    organizationId String

    manage         Boolean      @default(false)

    superadmin     Boolean      @default(false)

    @@unique([userId,organizationId])
}

model Organization extends Profile {
    owner     User     @relation(fields: [ownerId], references: [id])
    ownerId   String   @default(auth().id)
    published Boolean  @default(false) @allow('read', access?[user == auth()])
    access    Access[]
}

            `,
    );

    const user = await db.$unuseAll().user.create({
        data: {
            username: 'test',
            displayName: 'test',
        },
    });

    const organization = await db.$unuseAll().organization.create({
        data: {
            displayName: 'test',
            owner: {
                connect: {
                    id: user.id,
                },
            },
            access: {
                create: {
                    user: {
                        connect: {
                            id: user.id,
                        },
                    },
                    manage: true,
                    superadmin: true,
                },
            },
        },
    });

    const foundUser = await db.profile.findFirst({
        where: {
            id: user.id,
        },
    });
    expect(foundUser).toMatchObject(user);

    const foundOrg = await db.profile.findFirst({
        where: {
            id: organization.id,
        },
    });
    // published field not readable
    expect(foundOrg).toMatchObject({ id: organization.id, displayName: 'test', type: 'Organization' });
    expect(foundOrg.published).toBeUndefined();

    const foundOrg1 = await db.$setAuth({ id: user.id }).profile.findFirst({
        where: {
            id: organization.id,
        },
    });
    // published field readable
    expect(foundOrg1.published).not.toBeUndefined();
});
