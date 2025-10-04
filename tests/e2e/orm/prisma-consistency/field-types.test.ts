import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
    sqliteSchema,
} from './test-utils';

describe('Field Types Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should reject optional array field', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]?
}
        `);

        expectValidationFailure(result);
    });

    it('should reject array field with SQLite', () => {
        const result = tester.runValidation(`
${sqliteSchema}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]
}
        `);

        expectValidationFailure(result);
    });

    it('should accept array field with PostgreSQL', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int      @id @default(autoincrement())
  tags  String[]
}
        `);

        expectValidationSuccess(result);
    });
});
