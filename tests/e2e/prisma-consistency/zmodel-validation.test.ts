import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface ValidationResult {
    success: boolean;
    errors: string[];
}

class ZenStackValidationTester {
    private testDir: string;
    private schemaPath: string;
    private cliPath: string;

    constructor(testDir: string) {
        this.testDir = testDir;
        this.schemaPath = join(testDir, 'zenstack', 'schema.zmodel');

        // Get path relative to current test file
        const currentDir = dirname(fileURLToPath(import.meta.url));
        this.cliPath = join(currentDir, '../node_modules/@zenstackhq/cli/bin/cli');
    }

    private setupTestDirectory() {
        if (existsSync(this.testDir)) {
            rmSync(this.testDir, { recursive: true, force: true });
        }
        mkdirSync(this.testDir, { recursive: true });
        mkdirSync(join(this.testDir, 'zenstack'), { recursive: true });

        // Create package.json
        writeFileSync(
            join(this.testDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'zenstack-validation-test',
                    version: '1.0.0',
                    private: true,
                },
                null,
                2,
            ),
        );
    }

    public runValidation(schema: string): ValidationResult {
        this.setupTestDirectory();
        writeFileSync(this.schemaPath, schema);

        try {
            execSync(`node ${this.cliPath} generate`, {
                cwd: this.testDir,
                stdio: 'pipe',
                encoding: 'utf8',
            });

            return {
                success: true,
                errors: [],
            };
        } catch (error: any) {
            return {
                success: false,
                errors: this.extractErrors(error.stderr),
            };
        }
    }

    private extractErrors(output: string): string[] {
        const lines = output.split('\n');
        const errors: string[] = [];

        for (const line of lines) {
            if (line.includes('Error:') || line.includes('error:') || line.includes('✖')) {
                errors.push(line.trim());
            }
        }

        return errors;
    }

    public cleanup() {
        if (existsSync(this.testDir)) {
            rmSync(this.testDir, { recursive: true, force: true });
        }
    }
}

describe('ZenStack validation consistency with Prisma', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = join(tmpdir(), 'zenstack-validation-test-' + randomUUID());
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    describe('basic_models', () => {
        it('should accept valid basic model with id field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject model without any unique criterion', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  email String
  name  String?
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject model with multiple @id fields', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @id
  name  String?
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject model with both @id field and @@id', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  
  @@id([firstName, lastName])
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject optional ID field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int?   @id @default(autoincrement())
  email String @unique
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject array ID field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int[]  @id
  email String @unique
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('compound_ids', () => {
        it('should accept valid compound ID with @@id', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  firstName String
  lastName  String
  age       Int
  
  @@id([firstName, lastName])
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject empty compound ID', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  firstName String
  lastName  String
  
  @@id([])
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('field_types', () => {
        it('should reject optional array field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]?
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject array field with SQLite', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should accept array field with PostgreSQL', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]
}
            `);

            expect(result.success).toBe(true);
        });
    });

    describe('relations_one_to_one', () => {
        it('should accept valid one-to-one relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  profile Profile?
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  user   User   @relation(fields: [userId], references: [id])
  userId Int    @unique
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject one-to-one relation without @unique on FK', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  profile Profile?
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  user   User   @relation(fields: [userId], references: [id])
  userId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject one-to-one relation missing opposite field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  profile Profile?
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  userId Int    @unique
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject one-to-one with both sides required', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id      Int     @id @default(autoincrement())
  email   String  @unique
  profile Profile
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String
  user   User   @relation(fields: [userId], references: [id])
  userId Int    @unique
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('relations_one_to_many', () => {
        it('should accept valid one-to-many relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject one-to-many without @relation annotation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject one-to-many relation referencing non-existent FK field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('relations_many_to_many', () => {
        it('should accept valid implicit many-to-many relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id      Int    @id @default(autoincrement())
  title   String
  authors User[]
}
            `);

            expect(result.success).toBe(true);
        });

        it('should accept valid explicit many-to-many relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int        @id @default(autoincrement())
  email String     @unique
  posts PostUser[]
}

model Post {
  id      Int        @id @default(autoincrement())
  title   String
  authors PostUser[]
}

model PostUser {
  user   User @relation(fields: [userId], references: [id])
  post   Post @relation(fields: [postId], references: [id])
  userId Int
  postId Int
  
  @@id([userId, postId])
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject implicit many-to-many with explicit @relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[] @relation(fields: [id], references: [id])
}

model Post {
  id      Int    @id @default(autoincrement())
  title   String
  authors User[]
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('relations_self', () => {
        it('should accept valid self relation with proper naming', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  manager    User?  @relation("UserManager", fields: [managerId], references: [id])
  managerId  Int?
  employees  User[] @relation("UserManager")
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject self relation without relation name', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  manager    User?  @relation(fields: [managerId], references: [id])
  managerId  Int?
  employees  User[]
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should accept self many-to-many relation', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  following  User[] @relation("UserFollows")
  followers  User[] @relation("UserFollows")
}
            `);

            expect(result.success).toBe(true);
        });
    });

    describe('relation_validation', () => {
        it('should reject mismatched length of fields and references arrays', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id, email])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject empty fields array', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [], references: [id])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject empty references array', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject partial relation specification with only fields', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject partial relation specification with only references', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(references: [id])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject both sides of relation with fields/references', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[] @relation(fields: [id], references: [authorId])
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject type mismatch between fields and references', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    String @id @default(cuid())
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('unique_constraints', () => {
        it('should accept valid compound unique constraint', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  email     String @unique
  
  @@unique([firstName, lastName])
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject empty unique constraint', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  
  @@unique([])
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should accept unique constraint on optional field', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int     @id @default(autoincrement())
  email String? @unique
  name  String
}
            `);

            expect(result.success).toBe(true);
        });
    });

    describe('enums', () => {
        it('should accept valid enum definition and usage', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
  MODERATOR
}

model User {
  id   Int    @id @default(autoincrement())
  role Role   @default(USER)
  name String
}
            `);

            expect(result.success).toBe(true);
        });

        it('should reject empty enum', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
}

model User {
  id   Int    @id @default(autoincrement())
  role Role   @default(USER)
  name String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('datasource', () => {
        it('should reject multiple datasources', () => {
            const result = tester.runValidation(`
datasource db1 {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

datasource db2 {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id   Int    @id @default(autoincrement())
  name String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject missing datasource', () => {
            const result = tester.runValidation(`
model User {
  id   Int    @id @default(autoincrement())
  name String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject invalid provider', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "nosql"
  url      = env("DATABASE_URL")
}

model User {
  id   Int    @id @default(autoincrement())
  name String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('attributes', () => {
        it('should reject duplicate field attributes', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @unique
  name  String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject invalid default value type', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @default(123)
  name  String
}
            `);

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should accept valid @map attribute', () => {
            const result = tester.runValidation(`
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @map("email_address")
  name  String
  
  @@map("users")
}
            `);

            expect(result.success).toBe(true);
        });
    });
});
