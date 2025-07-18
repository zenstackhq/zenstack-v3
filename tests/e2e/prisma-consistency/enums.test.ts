import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZenStackValidationTester, createTestDir, expectValidationSuccess, expectValidationFailure, baseSchema } from './test-utils';

describe('Enums Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid enum definition and usage', () => {
        const result = tester.runValidation(`
${baseSchema}

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

        expectValidationSuccess(result);
    });

    it('should reject empty enum', () => {
        const result = tester.runValidation(`
${baseSchema}

enum Role {
}

model User {
  id   Int    @id @default(autoincrement())
  role Role   @default(USER)
  name String
}
        `);

        expectValidationFailure(result);
    });
});