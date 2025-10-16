import { loadSchemaWithError } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue 177', () => {
    it('verifies issue 177', async () => {
        await loadSchemaWithError(
            `
            model Foo {
                id String @id @default(cuid())

                bar   Bar     @relation(fields: [barId1, barId2], references: [id1, id2])
                barId1 String?
                barId2 String
            }

            model Bar {
                id1  String @default(cuid())
                id2  String @default(cuid())
                foos Foo[]

                @@id([id1, id2])
            }
            `,
            'relation "bar" is not optional, but field "barId1" is optional',
        );
    });
});
