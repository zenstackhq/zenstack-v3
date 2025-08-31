import { describe, expect, it } from 'vitest';
import { loadSchema, loadSchemaWithError } from './utils';
import { DataModel, TypeDef } from '../src/ast';

describe('Mixin Tests', () => {
    it('supports model mixing types to Model', async () => {
        const model = await loadSchema(`
        type A {
            x String
        }

        type B {
            y String
        }

        model M with A B {
            id String @id
        }
        `);
        const m = model.declarations.find((d) => d.name === 'M') as DataModel;
        expect(m.mixins.length).toBe(2);
        expect(m.mixins[0].ref?.name).toBe('A');
        expect(m.mixins[1].ref?.name).toBe('B');
    });

    it('supports model mixing types to type', async () => {
        const model = await loadSchema(`
        type A {
            x String
        }

        type B {
            y String
        }

        type C with A B {
            z String
        }

        model M with C {
            id String @id
        }
        `);
        const c = model.declarations.find((d) => d.name === 'C') as TypeDef;
        expect(c?.mixins.length).toBe(2);
        expect(c?.mixins[0].ref?.name).toBe('A');
        expect(c?.mixins[1].ref?.name).toBe('B');
        const m = model.declarations.find((d) => d.name === 'M') as DataModel;
        expect(m.mixins[0].ref?.name).toBe('C');
    });

    it('can detect cyclic mixins', async () => {
        await loadSchemaWithError(
            `
        type A with B {
            x String
        }

        type B with A {
            y String
        }

        model M with A {
            id String @id
        }
        `,
            'cyclic',
        );
    });

    it('can detect duplicated fields from mixins', async () => {
        await loadSchemaWithError(
            `
        type A {
            x String
        }

        type B {
            x String
        }

        model M with A B {
            id String @id
        }
        `,
            'duplicated',
        );
    });

    it('can detect duplicated attributes from mixins', async () => {
        await loadSchemaWithError(
            `
        type A {
            x String
            @@id([x])
        }

        type B {
            y String
            @@id([y])
        }

        model M with A B {
        }
        `,
            'can only be applied once',
        );
    });

    it('does not allow relation fields in type', async () => {
        await loadSchemaWithError(
            `
        model User {
            id Int @id @default(autoincrement())
        }

        type T {
            u User
        }
        `,
            'Type field cannot be a relation',
        );
    });
});
