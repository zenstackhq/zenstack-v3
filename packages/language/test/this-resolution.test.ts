import { describe, expect, it } from 'vitest';
import { loadSchema, loadSchemaWithError } from './utils';

describe('This keyword resolution tests', () => {
    it('always resolves to the containing model', async () => {
        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }
            
            model A {
                id Int @id @default(autoincrement())
                av Int
                b B[]

                @@allow('read', b?[c?[cv == this.cv]])
            }

            model B {
                id Int @id @default(autoincrement())
                bv Int
                aId Int
                a A @relation(fields: [aId], references: [id])
                c C[]
            }

            model C {
                id Int @id @default(autoincrement())
                cv Int
                bId Int
                b B @relation(fields: [bId], references: [id])
            }
        `,
            /MemberAccessTarget named 'cv'/,
        );

        await expect(
            loadSchema(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }
            
            model A {
                id Int @id @default(autoincrement())
                av Int
                b B[]

                @@allow('read', b?[c?[cv == this.av]])
            }

            model B {
                id Int @id @default(autoincrement())
                bv Int
                aId Int
                a A @relation(fields: [aId], references: [id])
                c C[]
            }

            model C {
                id Int @id @default(autoincrement())
                cv Int
                bId Int
                b B @relation(fields: [bId], references: [id])
            }
        `),
        ).resolves.toBeTruthy();
    });
});
