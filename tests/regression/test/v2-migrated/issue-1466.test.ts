import { createTestClient, loadSchema } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 1466', () => {
    it('regression1', async () => {
        const db = await createTestClient(
            `
model UserLongLongLongLongLongLongLongLongName {
    id Int @id @default(autoincrement())
    level Int @default(0)
    asset AssetLongLongLongLongLongLongLongLongName @relation(fields: [assetId], references: [id])
    assetId Int @unique
}

model AssetLongLongLongLongLongLongLongLongName {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    viewCount Int @default(0)
    owner UserLongLongLongLongLongLongLongLongName?
    assetType String
    
    @@delegate(assetType)
}

model VideoLongLongLongLongLongLongLongLongName extends AssetLongLongLongLongLongLongLongLongName {
    duration Int
}        
                `,
            {
                usePrismaPush: true,
            },
        );

        const video = await db.VideoLongLongLongLongLongLongLongLongName.create({
            data: { duration: 100 },
        });

        await db.UserLongLongLongLongLongLongLongLongName.create({
            data: {
                asset: { connect: { id: video.id } },
            },
        });

        const userWithAsset = await db.UserLongLongLongLongLongLongLongLongName.findFirst({
            include: { asset: true },
        });

        expect(userWithAsset).toMatchObject({
            asset: { assetType: 'VideoLongLongLongLongLongLongLongLongName', duration: 100 },
        });
    });

    it('regression2', async () => {
        const db = await createTestClient(
            `
                model UserLongLongLongLongName {
                    id Int @id @default(autoincrement())
                    level Int @default(0)
                    asset AssetLongLongLongLongName @relation(fields: [assetId], references: [id])
                    assetId Int

                    @@unique([assetId])
                }
                
                model AssetLongLongLongLongName {
                    id Int @id @default(autoincrement())
                    createdAt DateTime @default(now())
                    viewCount Int @default(0)
                    owner UserLongLongLongLongName?
                    assetType String
                    
                    @@delegate(assetType)
                }
                
                model VideoLongLongLongLongName extends AssetLongLongLongLongName {
                    duration Int
                }        
                `,
            {
                usePrismaPush: true,
            },
        );

        const video = await db.VideoLongLongLongLongName.create({
            data: { duration: 100 },
        });

        await db.UserLongLongLongLongName.create({
            data: {
                asset: { connect: { id: video.id } },
            },
        });

        const userWithAsset = await db.UserLongLongLongLongName.findFirst({
            include: { asset: true },
        });

        expect(userWithAsset).toMatchObject({
            asset: { assetType: 'VideoLongLongLongLongName', duration: 100 },
        });
    });

    it('regression3', async () => {
        await loadSchema(
            `
model UserLongLongLongLongName {
    id Int @id @default(autoincrement())
    level Int @default(0)
    asset AssetLongLongLongLongName @relation(fields: [assetId], references: [id])
    assetId Int @unique
}

model AssetLongLongLongLongName {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    viewCount Int @default(0)
    owner UserLongLongLongLongName?
    assetType String
    
    @@delegate(assetType)
}

model VideoLongLongLongLongName1 extends AssetLongLongLongLongName {
    duration Int
}        

model VideoLongLongLongLongName2 extends AssetLongLongLongLongName {
    format String
}        
                `,
        );
    });

    it('regression4', async () => {
        await loadSchema(
            `
model UserLongLongLongLongName {
    id Int @id @default(autoincrement())
    level Int @default(0)
    asset AssetLongLongLongLongName @relation(fields: [assetId], references: [id])
    assetId Int @unique
}

model AssetLongLongLongLongName {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    viewCount Int @default(0)
    owner UserLongLongLongLongName?
    assetType String
    
    @@delegate(assetType)
}

model VideoLongLongLongLongName1 extends AssetLongLongLongLongName {
    duration Int
}        

model VideoLongLongLongLongName2 extends AssetLongLongLongLongName {
    format String
}        
                `,
        );
    });

    it('regression5', async () => {
        await loadSchema(
            `
model UserLongLongLongLongName {
    id Int @id @default(autoincrement())
    level Int @default(0)
    asset AssetLongLongLongLongName @relation(fields: [assetId], references: [id])
    assetId Int @unique(map: 'assetId_unique')
}

model AssetLongLongLongLongName {
    id Int @id @default(autoincrement())
    createdAt DateTime @default(now())
    viewCount Int @default(0)
    owner UserLongLongLongLongName?
    assetType String
    
    @@delegate(assetType)
}

model VideoLongLongLongLongName1 extends AssetLongLongLongLongName {
    duration Int
}        

model VideoLongLongLongLongName2 extends AssetLongLongLongLongName {
    format String
}        
            `,
        );
    });
});
