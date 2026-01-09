import { describe, it } from 'vitest';
import { loadSchemaWithError } from './utils';

describe('Procedure validation', () => {
    it('rejects unknown parameter type', async () => {
        await loadSchemaWithError(
            `
model User {
    id Int @id
}

procedure foo(a: NotAType): Int
            `,
            /unknown type|could not resolve reference/i,
        );
    });

    it('rejects unknown return type', async () => {
        await loadSchemaWithError(
            `
model User {
    id Int @id
}

procedure foo(): NotAType
            `,
            /unknown type|could not resolve reference/i,
        );
    });

    it('rejects reserved procedure names', async () => {
        await loadSchemaWithError(
            `
model User {
    id Int @id
}

procedure __proto__(): Int
            `,
            /reserved/i,
        );
    });
});
