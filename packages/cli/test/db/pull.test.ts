import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, runCli } from '../utils';

const getSchema = (workDir: string) => fs.readFileSync(path.join(workDir, 'zenstack/schema.zmodel')).toString();

describe('DB pull', () => {
    it('simple schema', () => {
        const workDir = createProject(
`model User {
    id             String   @id @default(cuid())
    email          String   @unique @map("email_address")
    name           String?  @default("Anonymous")
    role           Role     @default(USER)
    profile        Profile?
    shared_profile Profile? @relation("shared")
    posts          Post[]
    createdAt      DateTime @default(now())
    updatedAt      DateTime @updatedAt
    jsonData       Json?
    balance        Decimal  @default(0.00)
    isActive       Boolean  @default(true)
    bigCounter     BigInt   @default(0)
    bytes          Bytes?

    @@index([role])
    @@map("users")
}

model Profile {
    id            Int     @id @default(autoincrement())
    user          User    @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId        String  @unique
    user_shared   User    @relation("shared", fields: [shared_userId], references: [id], onDelete: Cascade)
    shared_userId String  @unique
    bio           String?
    avatarUrl     String?

    @@map("profiles")
}

model Post {
    id        Int       @id @default(autoincrement())
    author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
    title     String
    content   String?
    published Boolean   @default(false)
    tags      PostTag[]
    createdAt DateTime  @default(now())
    updatedAt DateTime  @updatedAt
    slug      String
    score     Float     @default(0.0)
    metadata  Json?

    @@unique([authorId, slug])
    @@index([authorId, published])
    @@map("posts")
}

model Tag {
    id        Int       @id @default(autoincrement())
    name      String    @unique
    posts     PostTag[]
    createdAt DateTime  @default(now())

    @@index([name], name: "tag_name_idx")
    @@map("tags")
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

enum Role {
    USER
    ADMIN
    MODERATOR
}`);
        runCli('format', workDir);
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);
        expect(getSchema(workDir)).toEqual(originalSchema);
    });
});
