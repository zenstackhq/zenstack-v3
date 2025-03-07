import { expect } from 'vitest';

expect.extend({
    async toResolveTruthy(received: Promise<unknown>) {
        const r = await received;
        return {
            pass: !!r,
            message: () =>
                `Expected promise to resolve to a truthy value, but got ${r}`,
        };
    },

    async toResolveFalsy(received: Promise<unknown>) {
        const r = await received;
        return {
            pass: !r,
            message: () =>
                `Expected promise to resolve to a falsy value, but got ${r}`,
        };
    },

    async toResolveWithLength(received: Promise<unknown>, length: number) {
        const r = await received;
        return {
            pass: Array.isArray(r) && r.length === length,
            message: () =>
                `Expected promise to resolve with an array with length ${length}, but got ${r}`,
        };
    },
});
