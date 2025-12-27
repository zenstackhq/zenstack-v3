/**
 * Prefix for react-query keys.
 */
export const QUERY_KEY_PREFIX = 'zenstack';

export type QueryKey = [
    string /* prefix */,
    string /* model */,
    string /* operation */,
    unknown /* args */,
    {
        infinite: boolean;
        optimisticUpdate: boolean;
    } /* flags */,
];

/**
 * Computes query key for the given model, operation and query args.
 * @param model Model name.
 * @param operation Query operation (e.g, `findMany`) or request URL. If it's a URL, the last path segment will be used as the operation name.
 * @param args Query arguments.
 * @param options Query options, including `infinite` indicating if it's an infinite query (defaults to false), and `optimisticUpdate` indicating if optimistic updates are enabled (defaults to true).
 * @returns Query key
 */
export function getQueryKey(
    model: string,
    operation: string,
    args: unknown,
    options: { infinite: boolean; optimisticUpdate: boolean } = { infinite: false, optimisticUpdate: true },
): QueryKey {
    const infinite = options.infinite;
    // infinite query doesn't support optimistic updates
    const optimisticUpdate = options.infinite ? false : options.optimisticUpdate;
    return [QUERY_KEY_PREFIX, model, operation!, args, { infinite, optimisticUpdate }];
}

/**
 * Parses the given query key into its components.
 */
export function parseQueryKey(queryKey: readonly unknown[]) {
    const [prefix, model, operation, args, flags] = queryKey as QueryKey;
    if (prefix !== QUERY_KEY_PREFIX) {
        return undefined;
    }
    return { model, operation, args, flags };
}

export function isZenStackQueryKey(queryKey: readonly unknown[]): queryKey is QueryKey {
    if (queryKey.length < 5) {
        return false;
    }

    if (queryKey[0] !== QUERY_KEY_PREFIX) {
        return false;
    }

    return true;
}
