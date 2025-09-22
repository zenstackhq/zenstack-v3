import { describe, expect, it } from 'vitest';
import { DataModel } from '../src/ast';
import { loadSchema, loadSchemaWithError } from './utils';

describe('Delegate Tests', () => {
    it('supports inheriting from delegate', async () => {
        const model = await loadSchema(`
        datasource db {
            provider = 'sqlite'
            url      = 'file:./dev.db'
        }
        
        model A {
            id Int @id @default(autoincrement())
            x String
            @@delegate(x)
        }

        model B extends A {
            y String
        }
        `);
        const a = model.declarations.find((d) => d.name === 'A') as DataModel;
        expect(a.baseModel).toBeUndefined();
        const b = model.declarations.find((d) => d.name === 'B') as DataModel;
        expect(b.baseModel?.ref).toBe(a);
    });

    it('rejects inheriting from non-delegate models', async () => {
        await loadSchemaWithError(
            `
        datasource db {
            provider = 'sqlite'
            url      = 'file:./dev.db'
        }
        
        model A {
            id Int @id @default(autoincrement())
            x String
        }

        model B extends A {
            y String
        }
        `,
            'not a delegate model',
        );
    });

    it('can detect cyclic inherits', async () => {
        await loadSchemaWithError(
            `
        datasource db {
            provider = 'sqlite'
            url      = 'file:./dev.db'
        }
        
        model A extends B {
            x String
            @@delegate(x)
        }

        model B extends A {
            y String
            @@delegate(y)
        }
        `,
            'cyclic',
        );
    });

    it('can detect duplicated fields from base model', async () => {
        await loadSchemaWithError(
            `
        datasource db {
            provider = 'sqlite'
            url      = 'file:./dev.db'
        }
        
        model A {
            id String @id
            x String
            @@delegate(x)
        }

        model B extends A {
            x String
        }
        `,
            'duplicated',
        );
    });

    it('can detect duplicated attributes from base model', async () => {
        await loadSchemaWithError(
            `
        datasource db {
            provider = 'sqlite'
            url      = 'file:./dev.db'
        }
        
        model A {
            id String @id
            x String
            @@id([x])
            @@delegate(x)
        }

        model B extends A {
            y String
            @@id([y])
        }
        `,
            'can only be applied once',
        );
    });
});
