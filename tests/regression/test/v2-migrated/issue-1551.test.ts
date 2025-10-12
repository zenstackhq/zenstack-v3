import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 1551', async () => {
    await loadSchema(
        `
model User {
    id Int @id
    profile Profile? @relation(fields: [profileId], references: [id])
    profileId Int? @unique @map('profile_id')
}

model Profile {
    id Int @id
    contentType String
    user User?

    @@delegate(contentType)
}

model IndividualProfile extends Profile {
    name String    
}
            `,
    );
});
