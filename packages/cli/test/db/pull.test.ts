import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormattedProject, createProject, getDefaultPrelude, runCli } from '../utils';
import { loadSchemaDocument } from '../../src/actions/action-utils';
import { ZModelCodeGenerator, formatDocument } from '@zenstackhq/language';
import { getTestDbProvider } from '@zenstackhq/testtools';

const getSchema = (workDir: string) => fs.readFileSync(path.join(workDir, 'zenstack/schema.zmodel')).toString();
const generator = new ZModelCodeGenerator({
    quote: 'double',
    indent: 4,
});

describe('DB pull - Common features (all providers)', () => {
    describe('Pull from zero - restore complete schema from database', () => {
        it('should restore basic schema with all supported types', async () => {
            const workDir = await createFormattedProject(
                `model User {
    id         Int      @id @default(autoincrement())
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
        });

        it('should restore schema with relations', async () => {
            const workDir = await createFormattedProject(
                `model Post {
    id       Int    @id @default(autoincrement())
    title    String
    author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId Int
}

model User {
    id    Int    @id @default(autoincrement())
    email String @unique
    posts Post[]
}`,
            );
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
            const workDir = await createFormattedProject(
                `model Post {
    id   Int       @id @default(autoincrement())
    title String
    postTags PostTag[]
}

model PostTag {
    post   Post @relation(fields: [postId], references: [id], onDelete: Cascade)
    postId Int
    tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
    tagId  Int

    @@id([postId, tagId])
}

model Tag {
    id    Int       @id @default(autoincrement())
    name  String    @unique
    postTags PostTag[]
}`,
            );
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
            const workDir = await createFormattedProject(
                `model User {
    id        Int      @id @default(autoincrement())
    email     String   @unique
    username  String
    firstName String
    lastName  String
    role      String

    @@unique([username, email])
    @@index([role])
    @@index([firstName, lastName])
    @@index([email, username, role])
}`,
            );
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
            const workDir = await createFormattedProject(
                `model UserRole {
    userId String
    role   String
    grantedAt DateTime @default(now())

    @@id([userId, role])
}`,
            );
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
        it('should preserve field and table mappings', async () => {
            const workDir = await createFormattedProject(
                `model User {
    id         Int    @id @default(autoincrement())
    email      String @unique @map("email_address")
    firstName  String @map("first_name")
    lastName   String @map("last_name")

    @@map("users")
}`,
            );
            runCli('db push', workDir);

            const originalSchema = getSchema(workDir);
            runCli('db pull --indent 4', workDir);

            expect(getSchema(workDir)).toEqual(originalSchema);
        });

        it('should not modify a comprehensive schema with all features', async () => {
            const workDir = await createFormattedProject(`model User {
    id             Int      @id @default(autoincrement())
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
    userId        Int     @unique
    user_shared   User    @relation("shared", fields: [shared_userId], references: [id], onDelete: Cascade)
    shared_userId Int     @unique
    bio           String?
    avatarUrl     String?

    @@map("profiles")
}

model Post {
    id        Int       @id @default(autoincrement())
    author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  Int
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
            runCli('db push', workDir);

            const originalSchema = getSchema(workDir);
            runCli('db pull --indent 4', workDir);
            expect(getSchema(workDir)).toEqual(originalSchema);
        });

        it('should preserve imports when pulling with multi-file schema', async () => {
            const workDir = createProject('', { customPrelude: true });
            const schemaPath = path.join(workDir, 'zenstack/schema.zmodel');
            const modelsDir = path.join(workDir, 'zenstack/models');

            fs.mkdirSync(modelsDir, { recursive: true });

            // Create main schema with imports
            const mainSchema = await formatDocument(`import "./models/user"
import "./models/post"

${getDefaultPrelude()}`);
            fs.writeFileSync(schemaPath, mainSchema);

            // Create user model
            const userModel = await formatDocument(`import "./post"

model User {
    id        Int      @id @default(autoincrement())
    email     String   @unique
    name      String?
    posts     Post[]
    createdAt DateTime @default(now())
}`);
            fs.writeFileSync(path.join(modelsDir, 'user.zmodel'), userModel);

            // Create post model
            const postModel = await formatDocument(`import "./user"

model Post {
    id        Int      @id @default(autoincrement())
    title     String
    content   String?
    author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  Int
    createdAt DateTime @default(now())
}`);
            fs.writeFileSync(path.join(modelsDir, 'post.zmodel'), postModel);

            runCli('db push', workDir);

            // Pull and verify imports are preserved
            runCli('db pull --indent 4', workDir);

            const pulledMainSchema = fs.readFileSync(schemaPath).toString();
            const pulledUserSchema = fs.readFileSync(path.join(modelsDir, 'user.zmodel')).toString();
            const pulledPostSchema = fs.readFileSync(path.join(modelsDir, 'post.zmodel')).toString();

            expect(pulledMainSchema).toEqual(mainSchema);
            expect(pulledUserSchema).toEqual(userModel);
            expect(pulledPostSchema).toEqual(postModel);
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
        const workDir = await createFormattedProject(
            `model User {
    id    Int    @id @default(autoincrement())
    email String @unique
    posts Post[]

    @@schema("auth")
}

model Post {
    id       Int    @id @default(autoincrement())
    title    String
    author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId Int

    @@schema("content")
}`,
            { provider: 'postgresql' },
        );
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

    it('should preserve native PostgreSQL enums when schema exists', async ({ skip }) => {
        const provider = getTestDbProvider();
        if (provider !== 'postgresql') {
            skip();
            return;
        }
        const workDir = await createFormattedProject(
            `model User {
    id     Int        @id @default(autoincrement())
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
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);
        const pulledSchema = getSchema(workDir);

        expect(pulledSchema).toEqual(originalSchema);
        expect(pulledSchema).toContain('enum UserStatus');
        expect(pulledSchema).toContain('enum UserRole');
    });

    it('should not modify schema with PostgreSQL-specific features', async ({ skip }) => {
        const provider = getTestDbProvider();
        if (provider !== 'postgresql') {
            skip();
            return;
        }
        const workDir = await createFormattedProject(
            `model User {
    id       Int        @id @default(autoincrement())
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
    authorId Int
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
        runCli('db push', workDir);

        const originalSchema = getSchema(workDir);
        runCli('db pull --indent 4', workDir);

        expect(getSchema(workDir)).toEqual(originalSchema);
    });
});
