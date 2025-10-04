import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('One-to-One Relations Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid one-to-one relation', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationSuccess(result);
    });

    it('should reject one-to-one relation without @unique on FK', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject one-to-one relation missing opposite field', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });

    it('should reject one-to-one with both sides required', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationFailure(result);
    });
});
