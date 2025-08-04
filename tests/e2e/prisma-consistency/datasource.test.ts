import { afterEach, beforeEach, describe, it } from 'vitest';
import { ZenStackValidationTester, createTestDir, expectValidationFailure } from './test-utils';

describe('Datasource Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

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

        expectValidationFailure(result);
    });

    it('should reject missing datasource', () => {
        const result = tester.runValidation(`
model User {
  id   Int    @id @default(autoincrement())
  name String
}
        `);

        expectValidationFailure(result);
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

        expectValidationFailure(result);
    });
});
