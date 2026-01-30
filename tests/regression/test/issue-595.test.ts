import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 595', () => {
    it('verifies the issue', async () => {
        const db = await createPolicyTestClient(
            `
enum Role {
  admin @map('administrator')
  editor
  viewer

  @@map('roles')
}

type AuthUser {
  id    String
  roles Role[]

  @@auth
}

model User {
  id       String    @id @default(cuid())
  name     String
  email    String?   @unique
  posts    Post[]
  profile  Profile?
  
  @@allow('read', auth() != null)
  @@allow('update', auth().id == this.id)
  @@allow('all', has(auth().roles, admin))
}

model Profile {
  id        String  @id @default(cuid())
  userId    String  @unique
  bio       String?
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@allow('read', auth() != null)
  @@allow('create', userId == auth().id)
  @@allow('update', userId == auth().id)
  @@allow('all', has(auth().roles, admin))
}

model Post {
  id        String   @id @default(cuid())
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  
  @@allow('read', auth() != null)
  @@allow('create', authorId == auth().id)
  @@allow('update', hasSome(auth().roles, [admin, editor]))
}
  `,
            { usePrismaPush: true, provider: 'postgresql' },
        );

        const adminDb = db.$setAuth({ roles: ['admin'] });
        const userId = 'user-123';
        const userDb = db.$setAuth({ id: userId, roles: ['editor'] });
        const otherRoleDb = db.$setAuth({ roles: ['viewer'] });

        await expect(
            db.user.create({
                data: { id: 'user-123', name: 'User 123' },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            adminDb.user.create({
                data: { id: 'user-123', name: 'User 123' },
            }),
        ).toResolveTruthy();

        await userDb.user.update({
            data: {
                profile: {
                    upsert: {
                        create: { bio: 'Hello' },
                        update: { bio: 'Hello' },
                        where: { userId },
                    },
                },
            },
            where: { id: userId },
        });

        const postId = 'post-123';

        await expect(
            userDb.post.create({
                data: {
                    id: postId,
                    title: 'First Post',
                    authorId: userId,
                },
            }),
        ).toResolveTruthy();

        await expect(
            otherRoleDb.post.update({
                where: { id: postId },
                data: { title: 'Updated Title' },
            }),
        ).toBeRejectedNotFound();

        await expect(
            userDb.post.update({
                where: { id: postId },
                data: { title: 'Updated Title' },
            }),
        ).toResolveTruthy();

        await expect(userDb.user.delete({ where: { id: userId } })).toBeRejectedNotFound();

        await expect(adminDb.user.delete({ where: { id: userId } })).toResolveTruthy();
    });
});
