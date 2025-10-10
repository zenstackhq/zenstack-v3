import { loadSchema, loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue 925', () => {
    it('member reference without using this', async () => {
        await loadSchemaWithError(
            `
            model User {
                id Int @id @default(autoincrement())
                company Company[]
                test Int
              
                @@allow('read', auth().company?[staff?[companyId == test]])
            }
              
            model Company {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
              
                staff Staff[]
                @@allow('read', true)
            }
              
            model Staff {
                id Int @id @default(autoincrement())
              
                company Company @relation(fields: [companyId], references: [id])
                companyId Int
              
                @@allow('read', true)
              }
            `,
            "Could not resolve reference to ReferenceTarget named 'test'.",
        );
    });

    it('reference with this', async () => {
        await loadSchema(
            `
            model User {
                id Int @id @default(autoincrement())
                company Company[]
                test Int
              
                @@allow('read', auth().company?[staff?[companyId == this.test]])
            }
              
            model Company {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
              
                staff Staff[]
                @@allow('read', true)
            }
              
            model Staff {
                id Int @id @default(autoincrement())
              
                company Company @relation(fields: [companyId], references: [id])
                companyId Int
              
                @@allow('read', true)
              }
            `,
        );
    });
});
