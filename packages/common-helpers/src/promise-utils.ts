/**
 * Utility to run promises sequentially.
 */
export async function sequential<T>(tasks: Promise<T>[]): Promise<T[]> {
    const results: T[] = [];
    for (const task of tasks) {
        results.push(await task);
    }
    return Promise.resolve(results);
}
