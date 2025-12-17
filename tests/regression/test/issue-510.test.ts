import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression tests for issue 510', () => {
    it('verifies the issue', async () => {
        const schema = `
type ID {
    id String @id @default(nanoid())
}

type Timestamps {
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}

type Base with ID, Timestamps {
}

type AuthInfo {
    id       String
    username String
    role     Role

    @@auth
}

enum Role {
    SUPERADMIN
    ADMIN
    USER
}

enum FileStatus {
    PENDING
    UPLOADED
    FAILED
}

model User with Base {
    username     String         @unique
    passwordHash String
    name         String
    role         Role

    RefreshToken RefreshToken[]
    File         File[]
    Post         Post[]

    @@allow('all', auth().id == id)
}

model File with Timestamps {
    key              String     @id

    userId           String
    User             User       @relation(fields: [userId], references: [id])

    originalFilename String
    filename         String
    contentType      String
    size             Int?
    status           FileStatus

    Post             Post[]

    @@allow('all', auth().id == userId)
}

model AuditLog {
    timestamp DateTime @id @default(now())

    action    String
    data      Json

    @@deny('all', true)
}

model RefreshToken with Base {
    userId  String
    User    User    @relation(fields: [userId], references: [id])

    revoked Boolean

    @@deny('all', true)
}

model Post with Base {
    userId   String
    User     User    @relation(fields: [userId], references: [id])

    content  String
    imageKey String?
    Image    File?   @relation(fields: [imageKey], references: [key])

    @@allow('read', true)
    @@allow('create', auth().id == userId && (!Image || auth().id == Image.userId))
    @@allow('update,delete', auth().id == userId)
}
`;

        await expect(createPolicyTestClient(schema)).rejects.toThrow(/operand of "!" must be of Boolean type/);
    });
});
