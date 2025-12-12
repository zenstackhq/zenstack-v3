import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { schema, type SchemaType } from './zenstack/schema';

describe('Rally app tests', () => {
    let db: ClientContract<SchemaType, any>;

    beforeEach(async () => {
        db = (await createTestClient(schema, {
            provider: 'postgresql',
            schemaFile: path.join(__dirname, 'zenstack/schema.zmodel'),
            copyFiles: [
                {
                    globPattern: 'zenstack/models/*',
                    destination: 'models',
                },
            ],
            dataSourceExtensions: ['citext'],
            usePrismaPush: true,
        })) as any;
    });

    it('works with queries', async () => {
        await expect(
            db.spaceMember.findMany({
                where: {
                    userId: '1',
                },
                orderBy: {
                    lastSelectedAt: 'desc',
                },
                include: {
                    space: {
                        select: {
                            id: true,
                            ownerId: true,
                            name: true,
                            tier: true,
                            image: true,
                        },
                    },
                },
            }),
        ).toResolveTruthy();
    });
});
