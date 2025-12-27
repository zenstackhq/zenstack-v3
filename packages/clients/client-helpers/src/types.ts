/**
 * A type that represents either a value of type T or a Promise that resolves to type T.
 */
export type MaybePromise<T> = T | Promise<T> | PromiseLike<T>;

/**
 * List of ORM write actions.
 */
export const ORMWriteActions = [
    'create',
    'createMany',
    'createManyAndReturn',
    'connectOrCreate',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'upsert',
    'connect',
    'disconnect',
    'set',
    'delete',
    'deleteMany',
] as const;

/**
 * Type representing ORM write action types.
 */
export type ORMWriteActionType = (typeof ORMWriteActions)[number];

/**
 * Type for query and mutation errors.
 */
export type QueryError = Error & {
    /**
     * Additional error information.
     */
    info?: unknown;

    /**
     * HTTP status code.
     */
    status?: number;
};

/**
 * Information about a cached query.
 */
export type QueryInfo = {
    /**
     * Model of the query.
     */
    model: string;

    /**
     * Query operation, e.g., `findUnique`
     */
    operation: string;

    /**
     * Query arguments.
     */
    args: unknown;

    /**
     * Current data cached for this query.
     */
    data: unknown;

    /**
     * Whether optimistic update is enabled for this query.
     */
    optimisticUpdate: boolean;

    /**
     * Function to update the cached data.
     *
     * @param data New data to set.
     * @param cancelOnTheFlyQueries Whether to cancel on-the-fly queries to avoid accidentally
     * overwriting the optimistic update.
     */
    updateData: (data: unknown, cancelOnTheFlyQueries: boolean) => void;
};
