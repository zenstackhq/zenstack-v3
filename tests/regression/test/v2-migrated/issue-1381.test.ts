import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1381', () => {
    it('verifies issue 1381', async () => {
        await loadSchema(
            `
enum MemberRole {
    owner
    admin
}

enum SpaceType {
    contractor
    public
    private
}

model User {
  id String @id @default(cuid())
  name String?
  email String? @unique @lower
  memberships Membership[]
}

model Membership {
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  spaceId String
  space Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  role MemberRole
  @@id([userId, spaceId])
}

model Space {
  id String @id @default(cuid())
  name String
  type SpaceType @default(private)
  memberships Membership[]
  options Option[]
}

model Option {
  id String @id @default(cuid())
  name String?
  spaceId String?
  space Space? @relation(fields: [spaceId], references: [id], onDelete: SetNull)

  @@allow("post-update",
    space.type in [contractor, public] &&
    space.memberships?[space.type in [contractor, public] && auth() == user && role in [owner, admin]]
  )
}
            `,
        );
    });
});
