import { loadDocument } from '@zenstackhq/language';
import { describe, it } from 'vitest';

describe('Regression for issue #392', () => {
    it('verifies issue 392', async () => {
        await loadDocument(
            `
            model M1 {
                m2_id String @id
                m2 M2 @relation(fields: [m2_id], references: [id])
            }

            model M2 {
                id String @id
                m1 M1?
            }
              `,
        );

        await loadDocument(
            `
            model M1 {
                id String @id
                m2_id String @unique
                m2 M2 @relation(fields: [m2_id], references: [id])
            }

            model M2 {
                id String @id
                m1 M1?
            }
              `,
        );

        await loadDocument(
            `
            model M1 {
                m2_id String
                m2 M2 @relation(fields: [m2_id], references: [id])
                @@id([m2_id])
            }

            model M2 {
                id String @id
                m1 M1?
            }
              `,
        );

        await loadDocument(
            `
            model M1 {
                m2_id String
                m2 M2 @relation(fields: [m2_id], references: [id])
                @@unique([m2_id])
            }

            model M2 {
                id String @id
                m1 M1?
            }
              `,
        );
    });
});
