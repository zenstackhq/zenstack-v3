import { describe, it } from 'vitest';
import { loadSchema, loadSchemaWithError } from './utils';

describe('Function Invocation Tests', () => {
    it('id functions should not require format strings', async () => {
        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid())
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(7))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(nanoid())
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(nanoid(8))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(ulid())
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(cuid())
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(cuid(2))
            }  
        `,
        );
    });

    it('id functions should allow valid format strings', async () => {
        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(7, '%s_user'))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(cuid(2, '%s'))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(ulid('user_%s'))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(nanoid(8, 'user_%s'))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(7, '\\\\%s_%s'))
            }  
        `,
        );

        await loadSchema(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(7, '%s_\\\\%s'))
            }  
        `,
        );
    });

    it('id functions should reject invalid format strings', async () => {
        await loadSchemaWithError(`
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(cuid(2, ''))
            }  
        `, 'argument must include');

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(4, '\\\\%s'))
            }  
        `, 'argument must include');

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(4, '\\\\%s\\\\%s'))
            }  
        `, 'argument must include');

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(uuid(7, 'user_%'))
            }  
        `,
            'argument must include',
        );

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(nanoid(8, 'user'))
            }  
        `,
            'argument must include',
        );

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(ulid('user_%'))
            }  
        `,
            'argument must include',
        );

        await loadSchemaWithError(
            `
            datasource db {
                provider = 'sqlite'
                url      = 'file:./dev.db'
            }

            model User {
                id String @id @default(cuid(2, 'user_%'))
            }  
        `,
            'argument must include',
        );
    });
});
