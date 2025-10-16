import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1992', () => {
    it('verifies issue 1992', async () => {
        await loadSchema(
            `
enum MyAppUserType {
    Local
    Google
    Microsoft
}

model MyAppCompany {
    id          String            @id @default(cuid())
    name        String
    users       MyAppUser[]

    userFolders MyAppUserFolder[]
}

model MyAppUser {
    id          String            @id @default(cuid())
    companyId   String
    type        MyAppUserType

    @@delegate(type)

    company     MyAppCompany      @relation(fields: [companyId], references: [id])
    userFolders MyAppUserFolder[]
}

model MyAppUserLocal extends MyAppUser {
    email    String
    password String
}

model MyAppUserGoogle extends MyAppUser {
    googleId String
}

model MyAppUserMicrosoft extends MyAppUser {
    microsoftId String
}

model MyAppUserFolder {
    id        String       @id @default(cuid())
    companyId String
    userId    String
    path      String
    name      String

    @@unique([companyId, userId, name])
    @@unique([companyId, userId, path])

    company   MyAppCompany @relation(fields: [companyId], references: [id])
    user      MyAppUser    @relation(fields: [userId], references: [id])
}
            `,
        );
    });
});
