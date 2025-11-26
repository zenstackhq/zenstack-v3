import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';
import { schema } from '../schemas/basic';
import type { DefaultModelResult } from '@zenstackhq/orm';

describe('Ignored models and fields test', () => {
    it('correctly ignores fields', async () => {
        const db = await createTestClient(schema);
        db.user.findFirst({
            // @ts-expect-error
            where: { password: 'abc' },
        });

        const u: DefaultModelResult<typeof schema, 'User'> = {} as any;
        // @ts-expect-error
        noop(u.password);
    });

    it('correctly ignore models', async () => {
        const db = await createTestClient(schema);
        // @ts-expect-error
        db.foo.findFirst();
    });
});

function noop(_value: unknown) {}
