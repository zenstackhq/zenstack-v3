import { loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1758', () => {
    it('verifies issue 1758', async () => {
        await loadSchemaWithError(
            `
model Organization {
    id       String @id @default(cuid())
    contents Content[] @relation("OrganizationContents")
}

model Content {
    id             String @id @default(cuid())
    contentType    String
    organization   Organization @relation("OrganizationContents", fields: [organizationId], references: [id])
    organizationId String
    @@delegate(contentType)
}

model Store extends Content {
    name      String
    @@unique([organizationId, name])
}
            `,
            'Cannot use fields inherited from a polymorphic base model in `@@unique`',
        );
    });
});
