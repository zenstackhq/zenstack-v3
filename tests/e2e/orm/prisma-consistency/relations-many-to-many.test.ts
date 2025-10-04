import { afterEach, beforeEach, describe, it } from 'vitest';
import {
    ZenStackValidationTester,
    baseSchema,
    createTestDir,
    expectValidationFailure,
    expectValidationSuccess,
} from './test-utils';

describe('Many-to-Many Relations Validation', () => {
    let tester: ZenStackValidationTester;
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTestDir();
        tester = new ZenStackValidationTester(tempDir);
    });

    afterEach(() => {
        tester.cleanup();
    });

    it('should accept valid implicit many-to-many relation', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

model Post {
  id      Int    @id @default(autoincrement())
  title   String
  authors User[]
}
        `);

        expectValidationSuccess(result);
    });

    it('should accept valid explicit many-to-many relation', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int        @id @default(autoincrement())
  email String     @unique
  posts PostUser[]
}

model Post {
  id      Int        @id @default(autoincrement())
  title   String
  authors PostUser[]
}

model PostUser {
  user   User @relation(fields: [userId], references: [id])
  post   Post @relation(fields: [postId], references: [id])
  userId Int
  postId Int
  
  @@id([userId, postId])
}
        `);

        expectValidationSuccess(result);
    });

    it('should reject implicit many-to-many with explicit @relation', () => {
        const result = tester.runValidation(`
${baseSchema}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[] @relation(fields: [id], references: [id])
}

model Post {
  id      Int    @id @default(autoincrement())
  title   String
  authors User[]
}
        `);

        expectValidationFailure(result);
    });
});
