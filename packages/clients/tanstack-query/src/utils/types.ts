export type MaybePromise<T> = T | Promise<T> | PromiseLike<T>;

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

export type ORMWriteActionType = (typeof ORMWriteActions)[number];
