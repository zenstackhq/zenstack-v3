import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

// TODO: multi-schema support
describe.skip('Regression for issue 1647', () => {
    it('inherits @@schema by default', async () => {
        await loadSchema(
            `
            model Asset {
                id Int @id
                type String
                @@delegate(type)
                @@schema('public')
            }
            
            model Post extends Asset {
                title String
            }
            `,
        );
    });

    it('respects sub model @@schema overrides', async () => {
        await loadSchema(
            `
            datasource db {
                provider = 'postgresql'
                url = env('DATABASE_URL')
                schemas = ['public', 'post']
            }

            generator client {
                provider = 'prisma-client-js'
                previewFeatures = ['multiSchema']
            }

            model Asset {
                id Int @id
                type String
                @@delegate(type)
                @@schema('public')
            }
            
            model Post extends Asset {
                title String
                @@schema('post')
            }
            `,
        );
    });
});
