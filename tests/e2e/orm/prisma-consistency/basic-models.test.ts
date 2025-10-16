import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('Basic Models Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid basic model with id field', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject model without any unique criterion', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  email String
  name  String?
}
        `);

        expectValidationFailure(result);
    });

    it('should reject model with multiple @id fields', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @id
  name  String?
}
        `);

        expectValidationFailure(result);
    });

    it('should reject model with both @id field and @@id', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id        Int    @id @default(autoincrement())
  firstName String
  lastName  String
  
  @@id([firstName, lastName])
}
        `);

        expectValidationFailure(result);
    });

    it('should reject optional ID field', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int?   @id @default(autoincrement())
  email String @unique
}
        `);

        expectValidationFailure(result);
    });

    it('should reject array ID field', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int[]  @id
  email String @unique
}
        `);

        expectValidationFailure(result);
    });
});
