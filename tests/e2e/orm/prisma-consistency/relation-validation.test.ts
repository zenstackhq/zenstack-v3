import { afterEach, beforeEach, describe, it } from 'vitest';
import { ZenStackValidationTester, baseSchema, createTestDir, expectValidationFailure } from './test-utils';

describe('Relation Validation Rules', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should reject mismatched length of fields and references arrays', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject empty fields array', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject empty references array', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject partial relation specification with only fields', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject partial relation specification with only references', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject both sides of relation with fields/references', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject type mismatch between fields and references', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });
});
