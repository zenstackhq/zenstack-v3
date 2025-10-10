import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 961', () => {
    const schema = `
    model User {
        id String @id @default(cuid())
        backups UserColumnBackup[]
    }

    model UserColumnBackup {
        id String @id @default(cuid())
        user User @relation(fields: [userId], references: [id], onDelete: Cascade)
        userId String
        key String
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt()
        columns UserColumn[]
        @@unique([userId, key])
        @@allow('all', auth().id == userId)
    }
    
    model UserColumn {
        id String @id @default(cuid())
        userColumnBackup UserColumnBackup @relation(fields: [userColumnBackupId], references: [id], onDelete: Cascade)
        userColumnBackupId String
        column String
        version Int @default(0)
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt()
        
        @@unique([userColumnBackupId, column])
        @@allow('all', auth().id == userColumnBackup.userId)
        @@deny('update,delete', column == 'c2')
    }
    `;

    it('deleteMany', async () => {
        const db = await createPolicyTestClient(schema);

        const user = await db.$unuseAll().user.create({
            data: {
                backups: {
                    create: {
                        key: 'key1',
                        columns: {
                            create: [{ column: 'c1' }, { column: 'c2' }, { column: 'c3' }],
                        },
                    },
                },
            },
            include: { backups: true },
        });
        const backup = user.backups[0];

        const authDb = db.$setAuth({ id: user.id });

        // delete with non-existing outer filter
        await expect(
            authDb.userColumnBackup.update({
                where: { id: 'abc' },
                data: {
                    columns: {
                        deleteMany: {
                            column: 'c1',
                        },
                    },
                },
            }),
        ).toBeRejectedNotFound();
        await expect(authDb.userColumn.findMany()).resolves.toHaveLength(3);

        // delete c1
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    deleteMany: {
                        column: 'c1',
                    },
                },
            },
            include: { columns: true },
        });
        await expect(authDb.userColumn.findMany()).resolves.toHaveLength(2);

        // delete c1 again, no change
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    deleteMany: {
                        column: 'c1',
                    },
                },
            },
        });
        await expect(authDb.userColumn.findMany()).resolves.toHaveLength(2);

        // delete c2, filtered out by policy
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    deleteMany: {
                        column: 'c2',
                    },
                },
            },
        });
        await expect(authDb.userColumn.findMany()).resolves.toHaveLength(2);

        // delete c3, should succeed
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    deleteMany: {
                        column: 'c3',
                    },
                },
            },
        });
        await expect(authDb.userColumn.findMany()).resolves.toHaveLength(1);
    });

    it('updateMany', async () => {
        const db = await createPolicyTestClient(schema);

        const user = await db.$unuseAll().user.create({
            data: {
                backups: {
                    create: {
                        key: 'key1',
                        columns: {
                            create: [
                                { column: 'c1', version: 1 },
                                { column: 'c2', version: 2 },
                            ],
                        },
                    },
                },
            },
            include: { backups: true },
        });
        const backup = user.backups[0];

        const authDb = db.$setAuth({ id: user.id });

        // update with non-existing outer filter
        await expect(
            authDb.userColumnBackup.update({
                where: { id: 'abc' },
                data: {
                    columns: {
                        updateMany: {
                            where: { column: 'c1' },
                            data: { version: { increment: 1 } },
                        },
                    },
                },
            }),
        ).toBeRejectedNotFound();
        await expect(authDb.userColumn.findMany()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ column: 'c1', version: 1 }),
                expect.objectContaining({ column: 'c2', version: 2 }),
            ]),
        );

        // update c1
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    updateMany: {
                        where: { column: 'c1' },
                        data: { version: { increment: 1 } },
                    },
                },
            },
            include: { columns: true },
        });
        await expect(authDb.userColumn.findMany()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ column: 'c1', version: 2 }),
                expect.objectContaining({ column: 'c2', version: 2 }),
            ]),
        );

        // update c2, filtered out by policy
        await authDb.userColumnBackup.update({
            where: { id: backup.id },
            data: {
                columns: {
                    updateMany: {
                        where: { column: 'c2' },
                        data: { version: { increment: 1 } },
                    },
                },
            },
            include: { columns: true },
        });
        await expect(authDb.userColumn.findMany()).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ column: 'c1', version: 2 }),
                expect.objectContaining({ column: 'c2', version: 2 }),
            ]),
        );
    });
});
