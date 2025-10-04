import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('Unique Constraints Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid compound unique constraint', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  email     String @unique
  
  @@unique([firstName, lastName])
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject empty unique constraint', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  
  @@unique([])
}
        `);

        expectValidationFailure(result);
    });

    it('should accept unique constraint on optional field', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int     @id @default(autoincrement())
  email String? @unique
  name  String
}
        `);

        expectValidationSuccess(result);
    });
});
