import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('One-to-Many Relations Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid one-to-many relation', () => {
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
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject one-to-many without @relation annotation', () => {
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
  author   User
  authorId Int
}
        `);

        expectValidationFailure(result);
    });

    it('should reject one-to-many relation referencing non-existent FK field', () => {
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
  author   User   @relation(fields: [authorId], references: [id])
}
        `);

        expectValidationFailure(result);
    });
});
