import { createPolicyTestClient } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 1991', async () => {
    await createPolicyTestClient(
        `
type FooMetadata {
    isLocked Boolean
}

type FooOptionMetadata {
    color String
}

model Foo {
    id   String      @id @db.Uuid @default(uuid())
    meta FooMetadata @json
}

model FooOption {
    id   String            @id @db.Uuid @default(uuid())
    meta FooOptionMetadata @json
}
            `,
        {
            provider: 'postgresql',
            extraSourceFiles: {
                main: `
                        import { ZenStackClient } from '@zenstackhq/runtime';
                        import { schema } from './schema';

                        const db = new ZenStackClient(schema, {} as any);

                        db.fooOption.create({
                            data: { meta: { color: 'red' } }
                        })
                        `,
            },
        },
    );
});
