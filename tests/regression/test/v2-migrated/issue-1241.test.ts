import { createPolicyTestClient } from '@zenstackhq/testtools';
import { randomBytes } from 'crypto';
import { expect, it } from 'vitest';

it('verifies issue 1241', async () => {
    const db = await createPolicyTestClient(
        `
model User {
    id String @id @default(uuid())
    todos Todo[]

    @@auth
    @@allow('all', true)
}

model Todo {
    id String @id @default(uuid())

    user_id String
    user User @relation(fields: [user_id], references: [id])

    images File[] @relation("todo_images")
    documents File[] @relation("todo_documents")

    @@allow('all', true)
}

model File {
    id String @id @default(uuid())
    s3_key String @unique
    label String

    todo_image_id String?
    todo_image Todo? @relation("todo_images", fields: [todo_image_id], references: [id])

    todo_document_id String?
    todo_document Todo? @relation("todo_documents", fields: [todo_document_id], references: [id])

    @@allow('all', true)
}
                `,
    );

    const user = await db.$unuseAll().user.create({
        data: {},
    });
    await db.$unuseAll().todo.create({
        data: {
            user_id: user.id,

            images: {
                create: new Array(3).fill(null).map((_, i) => ({
                    s3_key: randomBytes(8).toString('hex'),
                    label: `img-label-${i + 1}`,
                })),
            },

            documents: {
                create: new Array(3).fill(null).map((_, i) => ({
                    s3_key: randomBytes(8).toString('hex'),
                    label: `doc-label-${i + 1}`,
                })),
            },
        },
    });

    const todo = await db.todo.findFirst({ where: {}, include: { documents: true } });
    await expect(
        db.todo.update({
            where: { id: todo.id },
            data: {
                documents: {
                    update: todo.documents.map((doc: any) => {
                        return {
                            where: { s3_key: doc.s3_key },
                            data: { label: 'updated' },
                        };
                    }),
                },
            },
            include: { documents: true },
        }),
    ).toResolveTruthy();
});
