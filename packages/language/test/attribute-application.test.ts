import { describe, it } from 'vitest';
import { loadSchemaWithError } from './utils';

describe('Attribute application validation tests', () => {
    it('rejects before in non-post-update policies', async () => {
        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }
            
            model Foo {
                id Int @id @default(autoincrement())
                x  Int
                @@allow('all', true)
                @@deny('update', before(x) > 2)
            }
            `,
            `"before()" is only allowed in "post-update" policy rules`,
        );
    });
});
