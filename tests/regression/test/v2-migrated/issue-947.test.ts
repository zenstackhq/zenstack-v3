import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 947', async () => {
    await loadSchema(
        `
datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
}

model Test {
    id    String @id
    props TestEnum[] @default([])
    }
    
enum TestEnum {
    A
    B
}
            `,
    );
});
