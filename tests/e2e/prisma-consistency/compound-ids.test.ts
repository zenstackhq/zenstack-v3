import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZenStackValidationTester, createTestDir, expectValidationSuccess, expectValidationFailure, baseSchema } from './test-utils';

describe('Compound IDs Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid compound ID with @@id', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  firstName String
  lastName  String
  age       Int
  
  @@id([firstName, lastName])
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject empty compound ID', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  firstName String
  lastName  String
  
  @@id([])
}
        `);

        expectValidationFailure(result);
    });
});