import type { OperationsIneligibleForDelegateModels } from '@zenstackhq/orm';
import type { GetModels, IsDelegateModel, SchemaDef } from '@zenstackhq/schema';

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

type HooksOperationsIneligibleForDelegateModels = OperationsIneligibleForDelegateModels extends any
    ? `use${Capitalize<OperationsIneligibleForDelegateModels>}`
    : never;

export type TrimDelegateModelOperations<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    T extends Record<string, unknown>,
> = IsDelegateModel<Schema, Model> extends true ? Omit<T, HooksOperationsIneligibleForDelegateModels> : T;

type WithOptimisticFlag<T> = T extends object
    ? T & {
          /**
           * Indicates if the item is in an optimistic update state
           */
          $optimistic?: boolean;
      }
    : T;

export type WithOptimistic<T> = T extends Array<infer U> ? Array<WithOptimisticFlag<U>> : WithOptimisticFlag<T>;
