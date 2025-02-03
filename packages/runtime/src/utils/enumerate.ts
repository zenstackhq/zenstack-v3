/**
 * Array or scalar
 */
export type Enumerable<T> = T | Array<T>;

/**
 * Uniformly enumerates an array or scalar.
 */
export function enumerate<T>(x: Enumerable<T>) {
    if (x === null || x === undefined) {
        return [];
    } else if (Array.isArray(x)) {
        return x;
    } else {
        return [x];
    }
}
