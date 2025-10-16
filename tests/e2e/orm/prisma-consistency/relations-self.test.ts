import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('Self Relations Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid self relation with proper naming', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  manager    User?  @relation("UserManager", fields: [managerId], references: [id])
  managerId  Int?
  employees  User[] @relation("UserManager")
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject self relation without relation name', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  manager    User?  @relation(fields: [managerId], references: [id])
  managerId  Int?
  employees  User[]
}
        `);

        expectValidationFailure(result);
    });

    it('should accept self many-to-many relation', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id         Int    @id @default(autoincrement())
  email      String @unique
  following  User[] @relation("UserFollows")
  followers  User[] @relation("UserFollows")
}
        `);

        expectValidationSuccess(result);
    });
});
