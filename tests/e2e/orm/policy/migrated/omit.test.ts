import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('prisma omit', () => {
    it('per query', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
              id   String @id @default(cuid())
              name String
              profile Profile?
              age Int
              value Int
              @@allow('all', age > 18)
            }
            
            model Profile {
              id   String @id @default(cuid())
              user User   @relation(fields: [userId], references: [id])
              userId String @unique
              level Int
              @@allow('all', level > 1)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                name: 'John',
                age: 25,
                value: 10,
                profile: {
                    create: { level: 2 },
                },
            },
        });

        let found = await db.user.findFirst({
            include: { profile: { omit: { level: true } } },
            omit: {
                age: true,
            },
        });
        expect(found.age).toBeUndefined();
        expect(found.value).toEqual(10);
        expect(found.profile.level).toBeUndefined();

        found = await db.user.findFirst({
            select: { value: true, profile: { omit: { level: true } } },
        });
        expect(found.age).toBeUndefined();
        expect(found.value).toEqual(10);
        expect(found.profile.level).toBeUndefined();
    });
});
