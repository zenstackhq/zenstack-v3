import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, getDefaultPrelude, runCli } from '../utils';
import { loadSchemaDocument } from '../../src/actions/action-utils';
import { ZModelCodeGenerator } from '@zenstackhq/language';

const getSchema = (workDir: string) => fs.readFileSync(path.join(workDir, 'zenstack/schema.zmodel')).toString();
const generator = new ZModelCodeGenerator({
    quote: 'double',
    indent: 4,
});

describe('DB pull - Sqlite specific', () => {
    it("simple schema - pull shouldn't modify the schema", () => {
        const workDir = createProject(`
model Post {
    id        Int       @id @default(1)
    author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
    title     String
    content   String?
    published Boolean   @default(false)
    tags      PostTag[]
    createdAt DateTime  @default(now())
    slug      String
    score     Float     @default(0.0)
    metadata  Json?

    @@unique([authorId, slug])
    @@index([authorId, published])
    @@map("posts")
}

model PostTag {
    post       Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
    postId     Int
    tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
    tagId      Int
    assignedAt DateTime @default(now())
    note       String?  @default("initial")

    @@id([postId, tagId])
    @@map("post_tags")
}

model Profile {
    id            Int     @id @default(1)
    user          User    @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId        String  @unique
    user_shared   User    @relation("shared", fields: [shared_userId], references: [id], onDelete: Cascade)
    shared_userId String  @unique
    bio           String?
    avatarUrl     String?

    @@map("profiles")
}

model Tag {
    id        Int       @id @default(1)
    name      String    @unique
    posts     PostTag[]
    createdAt DateTime  @default(now())

    @@index([name], name: "tag_name_idx")
    @@map("tags")
}

model User {
    id             String   @id @default(cuid())
    email          String   @unique @map("email_address")
    name           String?  @default("Anonymous")
    role           String   @default("USER")
    profile        Profile?
    shared_profile Profile? @relation("shared")
    posts          Post[]
    createdAt      DateTime @default(now())
    jsonData       Json?
    balance        Decimal  @default(0.00)
    isActive       Boolean  @default(true)
    bigCounter     BigInt   @default(0)
    bytes          Bytes?

    @@index([role])
    @@map("users")
}`,
        );
        runCli('format', workDir);
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);
        expect(getSchema(workDir)).toEqual(originalSchema);
    });

    it('simple schema - pull shouldn recreate the schema.zmodel', async () => {
        const workDir = createProject(
            `model Post {
    id        Int       @id @default(1)
    authorId  String
    title     String
    content   String?
    published Boolean   @default(false)
    createdAt DateTime  @default(now())
    slug      String
    score     Float     @default(0.0)
    metadata  Json?
    user      User      @relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Cascade)
    postTag   PostTag[]

    @@unique([authorId, slug])
    @@index([authorId, published])
}
model PostTag {
    postId     Int
    tagId      Int
    assignedAt DateTime @default(now())
    note       String?  @default("initial")
    post       Post     @relation(fields: [postId], references: [id], onDelete: Cascade, onUpdate: Cascade)
    tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade, onUpdate: Cascade)

    @@id([postId, tagId])
}

model Profile {
    id            Int     @id @default(1)
    userId        String  @unique
    sharedUserId String  @unique @map("shared_userId")
    bio           String?
    avatarUrl     String?
    
    profileUserId         User    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
    profileSharedUserId   User    @relation("shared", fields: [sharedUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)
}

model Tag {
    id          Int       @id @default(1)
    name        String    @unique
    createdAt   DateTime  @default(now())
    postTag     PostTag[]
    
    @@index([name], map: "tag_name_idx")
}
    
model User {
    id             String   @id
    email          String   @unique
    name           String?  @default("Anonymous")
    role           String   @default("USER")
    createdAt      DateTime @default(now())
    jsonData       Json?

    balance        Decimal  @default(0.00)
    isActive       Boolean  @default(true)
    bigCounter     BigInt   @default(0)
    bytes          Bytes?
    post          Post[]
    profileUserId        Profile?
    profileSharedUserId Profile? @relation("shared")

    @@index([role])
}`,
        );
        console.log(workDir)
        runCli('format', workDir);
        runCli('db push', workDir);
        const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
        const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
        const originalSchema = generator.generate(model);
        fs.writeFileSync(path.join(workDir, 'zenstack/schema.zmodel'), getDefaultPrelude());

        runCli('db pull --indent 4 --field-casing=camel', workDir);
        expect(getSchema(workDir)).toEqual(originalSchema);
    });
});
