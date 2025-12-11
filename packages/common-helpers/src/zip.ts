/**
 * Zips two arrays into an array of tuples.
 */
export function zip<T, U>(arr1: readonly T[], arr2: readonly U[]): Array<[T, U]> {
    const length = Math.min(arr1.length, arr2.length);
    const result: Array<[T, U]> = [];
    for (let i = 0; i < length; i++) {
        result.push([arr1[i]!, arr2[i]!]);
    }
    return result;
}
