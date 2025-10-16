import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1483', () => {
    it('verifies issue 1483', async () => {
        const db = await createTestClient(
            `
model User {
    @@auth
    id    String @id
    edits Edit[]
    @@allow('all', true)
}

model Entity {

    id    String @id @default(cuid())
    name  String
    edits Edit[]

    type  String
    @@delegate(type)

    @@allow('all', true)
}

model Person extends Entity {
}

model Edit {
    id       String  @id @default(cuid())

    authorId String?
    author   User?   @relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: NoAction)

    entityId String
    entity   Entity  @relation(fields: [entityId], references: [id], onDelete: Cascade, onUpdate: NoAction)

    @@allow('all', true)
}
            `,
        );

        await db.edit.deleteMany({});
        await db.person.deleteMany({});
        await db.user.deleteMany({});

        const person = await db.person.create({
            data: {
                name: 'test',
            },
        });

        await db.edit.create({
            data: {
                entityId: person.id,
            },
        });

        await expect(
            db.edit.findMany({
                include: {
                    author: true,
                    entity: true,
                },
            }),
        ).resolves.toHaveLength(1);
    });
});
