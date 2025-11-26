import type { DefaultModelResult } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('Ignored models and fields test', () => {
    it('correctly ignores fields', async () => {
        const db = await createTestClient(schema);
        db.user.findFirst({
            // @ts-expect-error
            where: { password: 'abc' },
        });

        const user = await db.user.create({ data: { email: 'u1@test.com' } });
        // @ts-expect-error
        expect(user.password).toBeUndefined();

        const u: DefaultModelResult<typeof schema, 'User'> = {} as any;
        // @ts-expect-error
        noop(u.password);
    });

    it('correctly ignores models', async () => {
        const db = await createTestClient(schema);
        // @ts-expect-error
        expect(db.foo).toBeUndefined();
    });
});

function noop(_value: unknown) {}
