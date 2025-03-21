import 'vitest';

interface CustomMatchers<R = unknown> {
    toResolveTruthy: () => Promise<R>;
    toResolveFalsy: () => Promise<R>;
    toResolveNull: () => Promise<R>;
    toResolveWithLength: (length: number) => Promise<R>;
    toRejectNotFound: () => Promise<R>;
}

declare module 'vitest' {
    interface Assertion<T = any> extends CustomMatchers<T> {}
    interface AsymmetricMatchersContaining extends CustomMatchers {}
}
