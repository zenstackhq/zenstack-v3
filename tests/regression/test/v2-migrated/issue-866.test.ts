import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: zod schema support
it.skip('verifies issue 866', async () => {
    const { zodSchemas } = await createTestClient(
        `
            model Model {
                id Int @id @default(autoincrement())
                a Int @default(100)
                b String @default('')
                c DateTime @default(now())
            }
            `,
    );

    const r = zodSchemas.models.ModelSchema.parse({ id: 1 });
    expect(r.a).toBe(100);
    expect(r.b).toBe('');
    expect(r.c).toBeInstanceOf(Date);
    expect(r.id).toBe(1);
});
