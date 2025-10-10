import { loadSchema, loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue 965', () => {
    it('regression1', async () => {
        await loadSchema(`
        type Base {
            id String @id @default(cuid())
        }

        type A {
            URL String? @url
        }

        type B {
            anotherURL String? @url
        }

        type C {
            oneMoreURL String? @url
        }
        
        model D with Base, A, B {
        }

        model E with Base, B, C {
        }`);
    });

    it('regression2', async () => {
        await loadSchemaWithError(
            `
        type A {
            URL String? @url
        }
        
        type B {
            anotherURL String? @url
        }
        
        type C {
            oneMoreURL String? @url
        }
        
        model D with A, B {
        }
        
        model E with B, C {
        }`,
            'Model must have at least one unique criteria. Either mark a single field with `@id`, `@unique` or add a multi field criterion with `@@id([])` or `@@unique([])` to the model.',
        );
    });
});
