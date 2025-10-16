import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1627', () => {
    it('verifies issue 1627', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
      id          String @id
      memberships GymUser[]
    }

    model Gym {
      id      String @id
      members GymUser[]

      @@allow('all', true)
    }

    model GymUser {
      id      String @id
      userID  String
      user    User @relation(fields: [userID], references: [id])
      gymID   String?
      gym     Gym? @relation(fields: [gymID], references: [id])
      role    String

      @@allow('read',gym.members?[user == auth() && (role == "ADMIN" || role == "TRAINER")])
      @@unique([userID, gymID])
    }
                `,
        );

        await db.$unuseAll().user.create({ data: { id: '1' } });

        await db.$unuseAll().gym.create({
            data: {
                id: '1',
                members: {
                    create: {
                        id: '1',
                        user: { connect: { id: '1' } },
                        role: 'ADMIN',
                    },
                },
            },
        });

        await expect(db.gymUser.findMany()).resolves.toHaveLength(0);
    });
});
