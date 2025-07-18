import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZenStackValidationTester, createTestDir, expectValidationSuccess, expectValidationFailure, baseSchema } from './test-utils';

describe('Attributes Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should reject duplicate field attributes', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @unique
  name  String
}
        `);

        expectValidationFailure(result);
    });

    it('should reject invalid default value type', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @default(123)
  name  String
}
        `);

        expectValidationFailure(result);
    });

    it('should accept valid @map attribute', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique @map("email_address")
  name  String
  
  @@map("users")
}
        `);

        expectValidationSuccess(result);
    });
});