import { expect } from 'vitest';
import { NotFoundError } from '../src/client/errors';

function isPromise(value: any) {
    return (
        typeof value.then === 'function' && typeof value.catch === 'function'
    );
}

function expectError(err: any, errorType: any) {
    if (err instanceof errorType) {
        return {
            message: () => '',
            pass: true,
        };
    } else {
        return {
            message: () => `expected ${errorType}, got ${err}`,
            pass: false,
        };
    }
}

expect.extend({
    async toResolveTruthy(received: Promise<unknown>) {
        if (!isPromise(received)) {
            return { message: () => 'a promise is expected', pass: false };
        }
        const r = await received;
        return {
            pass: !!r,
            message: () =>
                `Expected promise to resolve to a truthy value, but got ${r}`,
        };
    },

    async toResolveFalsy(received: Promise<unknown>) {
        if (!isPromise(received)) {
            return { message: () => 'a promise is expected', pass: false };
        }
        const r = await received;
        return {
            pass: !r,
            message: () =>
                `Expected promise to resolve to a falsy value, but got ${r}`,
        };
    },

    async toResolveNull(received: Promise<unknown>) {
        if (!isPromise(received)) {
            return { message: () => 'a promise is expected', pass: false };
        }
        const r = await received;
        return {
            pass: r === null,
            message: () =>
                `Expected promise to resolve to a null value, but got ${r}`,
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

    async toRejectNotFound(received: Promise<unknown>) {
        if (!isPromise(received)) {
            return { message: () => 'a promise is expected', pass: false };
        }
        try {
            await received;
        } catch (err) {
            return expectError(err, NotFoundError);
        }
        return {
            message: () => `expected NotFoundError, got no error`,
            pass: false,
        };
    },
});
