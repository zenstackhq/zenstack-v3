import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: field-level policy support
it.skip('verifies issue 1451', async () => {
    const db = await createTestClient(
        `
model User {
    id    String     @id
    memberships Membership[]
}

model Space {
    id           String          @id
    memberships  Membership[]
}

model Membership {
    userId            String
    user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    spaceId           String
    space             Space      @relation(fields: [spaceId], references: [id], onDelete: Cascade)
    
    role              String     @deny("update", auth() == user)
    employeeReference String?    @deny("read, update", space.memberships?[auth() == user && !(role in ['owner', 'admin'])])
    
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
    
    @@id([userId, spaceId])
    @@allow('all', true)
}            
            `,
    );

    await db.$unuseAll().user.create({
        data: { id: '1' },
    });

    await db.$unuseAll().space.create({
        data: { id: '1' },
    });

    await db.$unuseAll().membership.create({
        data: {
            user: { connect: { id: '1' } },
            space: { connect: { id: '1' } },
            role: 'foo',
            employeeReference: 'xyz',
        },
    });

    const r = await db.membership.findMany();
    expect(r).toHaveLength(1);
    expect(r[0].employeeReference).toBeUndefined();
});
