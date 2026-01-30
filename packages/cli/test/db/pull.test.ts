import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, getDefaultPrelude, runCli } from '../utils';
import { loadSchemaDocument } from '../../src/actions/action-utils';
import { ZModelCodeGenerator } from '@zenstackhq/language';
import { getTestDbProvider } from '@zenstackhq/testtools';

const getSchema = (workDir: string) => fs.readFileSync(path.join(workDir, 'zenstack/schema.zmodel')).toString();
const generator = new ZModelCodeGenerator({
    quote: 'double',
    indent: 4,
});

describe('DB pull - Common features (all providers)', () => {
    describe('Pull from zero - restore complete schema from database', () => {
        it('should restore basic schema with all supported types', async () => {
            const workDir = createProject(
                `model User {
    id         String   @id @default(cuid())
    email      String   @unique
    name       String?
    age        Int      @default(0)
    balance    Decimal  @default(0.00)
    isActive   Boolean  @default(true)
    bigCounter BigInt   @default(0)
    score      Float    @default(0.0)
    bio        String?
    avatar     Bytes?
    metadata   Json?
    createdAt  DateTime @default(now())
    updatedAt  DateTime @updatedAt
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            // Store the schema after db push (this is what provider names will be)
            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            // Remove schema content to simulate restoration from zero
            fs.writeFileSync(schemaFile, getDefaultPrelude());

            // Pull should fully restore the schema
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
            expect(restoredSchema).toContain('model User');
        });

        it('should restore schema with relations', async () => {
            const workDir = createProject(
                `model User {
    id    String @id @default(cuid())
    email String @unique
    posts Post[]
}

model Post {
    id       Int    @id @default(autoincrement())
    title    String
    author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId String
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            fs.writeFileSync(schemaFile, getDefaultPrelude());
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
        });

        it('should restore schema with many-to-many relations', async () => {
            const workDir = createProject(
                `model Post {
    id   Int       @id @default(autoincrement())
    title String
    tags PostTag[]
}

model Tag {
    id    Int       @id @default(autoincrement())
    name  String    @unique
    posts PostTag[]
}

model PostTag {
    post   Post @relation(fields: [postId], references: [id], onDelete: Cascade)
    postId Int
    tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
    tagId  Int

    @@id([postId, tagId])
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            fs.writeFileSync(schemaFile, getDefaultPrelude());
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
        });

        it('should restore schema with indexes and unique constraints', async () => {
            const workDir = createProject(
                `model User {
    id        String   @id @default(cuid())
    email     String   @unique
    username  String
    firstName String
    lastName  String
    role      String

    @@unique([username, email])
    @@index([role])
    @@index([firstName, lastName])
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            fs.writeFileSync(schemaFile, getDefaultPrelude());
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
        });

        it('should restore schema with composite primary keys', async () => {
            const workDir = createProject(
                `model UserRole {
    userId String
    role   String
    grantedAt DateTime @default(now())

    @@id([userId, role])
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            fs.writeFileSync(schemaFile, getDefaultPrelude());
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
        });

        it('should restore schema with field and table mappings', async () => {
            const workDir = createProject(
                `model User {
    id         String @id @default(cuid())
    email      String @unique @map("email_address")
    firstName  String @map("first_name")
    lastName   String @map("last_name")

    @@map("users")
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
            const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
            const expectedSchema = generator.generate(model);

            fs.writeFileSync(schemaFile, getDefaultPrelude());
            runCli('db pull --indent 4', workDir);

            const restoredSchema = getSchema(workDir);
            expect(restoredSchema).toEqual(expectedSchema);
        });
    });

    describe('Pull with existing schema - preserve schema features', () => {
        it('should not modify a comprehensive schema with all features', () => {
            const workDir = createProject(`model User {
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
}`,
            );
            runCli('format', workDir);
            runCli('db push', workDir);

            const originalSchema = getSchema(workDir);
            runCli('db pull --indent 4', workDir);
            expect(getSchema(workDir)).toEqual(originalSchema);
        });

        it('should preserve imports when pulling with multi-file schema', () => {
            const workDir = createProject('');
            const schemaPath = path.join(workDir, 'zenstack/schema.zmodel');
            const modelsDir = path.join(workDir, 'zenstack/models');
            fs.mkdirSync(modelsDir, { recursive: true });

            // Create main schema with imports
            const mainSchema = `${getDefaultPrelude()}

import './models/user'
import './models/post'`;
            fs.writeFileSync(schemaPath, mainSchema);

            // Create user model
            const userModel = `model User {
    id        String   @id @default(cuid())
    email     String   @unique
    name      String?
    posts     Post[]
    createdAt DateTime @default(now())
}`;
            fs.writeFileSync(path.join(modelsDir, 'user.zmodel'), userModel);

            // Create post model
            const postModel = `model Post {
    id        Int      @id @default(autoincrement())
    title     String
    content   String?
    author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
    createdAt DateTime @default(now())
}`;
            fs.writeFileSync(path.join(modelsDir, 'post.zmodel'), postModel);

            runCli('format', workDir);
            runCli('db push', workDir);

            // Store original schemas
            const originalMainSchema = fs.readFileSync(schemaPath).toString();
            const originalUserSchema = fs.readFileSync(path.join(modelsDir, 'user.zmodel')).toString();
            const originalPostSchema = fs.readFileSync(path.join(modelsDir, 'post.zmodel')).toString();

            // Pull and verify imports are preserved
            runCli('db pull --indent 4', workDir);

            const pulledMainSchema = fs.readFileSync(schemaPath).toString();
            const pulledUserSchema = fs.readFileSync(path.join(modelsDir, 'user.zmodel')).toString();
            const pulledPostSchema = fs.readFileSync(path.join(modelsDir, 'post.zmodel')).toString();

            expect(pulledMainSchema).toEqual(originalMainSchema);
            expect(pulledUserSchema).toEqual(originalUserSchema);
            expect(pulledPostSchema).toEqual(originalPostSchema);

            // Verify imports are still present in main schema
            expect(pulledMainSchema).toContain("import './models/user'");
            expect(pulledMainSchema).toContain("import './models/post'");
        });
    });
});

describe('DB pull - PostgreSQL specific features', () => {
    it('should restore schema with multiple database schemas', async ({ skip }) => {
        const provider = getTestDbProvider();
        if (provider !== 'postgresql') {
            skip();
            return;
        }
        const workDir = createProject(
            `model User {
    id    String @id @default(cuid())
    email String @unique
    posts Post[]

    @@schema("auth")
}

model Post {
    id       Int    @id @default(autoincrement())
    title    String
    author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId String

    @@schema("content")
}`,
            { provider: 'postgresql' },
        );
        runCli('format', workDir);
        runCli('db push', workDir);

        const schemaFile = path.join(workDir, 'zenstack/schema.zmodel');
        const { model } = await loadSchemaDocument(schemaFile, { returnServices: true });
        const expectedSchema = generator.generate(model);

        fs.writeFileSync(schemaFile, getDefaultPrelude({ provider: 'postgresql' }));
        runCli('db pull --indent 4', workDir);

        const restoredSchema = getSchema(workDir);
        expect(restoredSchema).toEqual(expectedSchema);
        expect(restoredSchema).toContain('@@schema("auth")');
        expect(restoredSchema).toContain('@@schema("content")');
    });

    it('should preserve native PostgreSQL enums when schema exists', ({ skip }) => {
        const provider = getTestDbProvider();
        if (provider !== 'postgresql') {
            skip();
            return;
        }
        const workDir = createProject(
            `model User {
    id     String     @id @default(cuid())
    email  String     @unique
    status UserStatus @default(ACTIVE)
    role   UserRole   @default(USER)
}

enum UserStatus {
    ACTIVE
    INACTIVE
    SUSPENDED
}

enum UserRole {
    USER
    ADMIN
    MODERATOR
}`,
            { provider: 'postgresql' },
        );
        runCli('format', workDir);
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);
        const pulledSchema = getSchema(workDir);

        expect(pulledSchema).toEqual(originalSchema);
        expect(pulledSchema).toContain('enum UserStatus');
        expect(pulledSchema).toContain('enum UserRole');
    });

    it('should not modify schema with PostgreSQL-specific features', ({ skip }) => {
        const provider = getTestDbProvider();
        if (provider !== 'postgresql') {
            skip();
            return;
        }
        const workDir = createProject(
            `model User {
    id       String     @id @default(cuid())
    email    String     @unique
    status   UserStatus @default(ACTIVE)
    posts    Post[]
    metadata Json?

    @@schema("auth")
    @@index([status])
}

model Post {
    id       Int    @id @default(autoincrement())
    title    String
    author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId String
    tags     String[]

    @@schema("content")
    @@index([authorId])
}

enum UserStatus {
    ACTIVE
    INACTIVE
    SUSPENDED
}`,
            { provider: 'postgresql' },
        );
        runCli('format', workDir);
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);

        expect(getSchema(workDir)).toEqual(originalSchema);
    });
});
