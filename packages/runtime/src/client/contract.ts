import type { Decimal } from 'decimal.js';
import { type GetModels, type ProcedureDef, type SchemaDef } from '../schema';
import type { AuthType } from '../schema/auth';
import type { OrUndefinedIf, UnwrapTuplePromises } from '../utils/type-utils';
import type { TRANSACTION_UNSUPPORTED_METHODS } from './constants';
import type {
    AggregateArgs,
    AggregateResult,
    BatchResult,
    CountArgs,
    CountResult,
    CreateArgs,
    CreateManyAndReturnArgs,
    CreateManyArgs,
    DeleteArgs,
    DeleteManyArgs,
    FindArgs,
    FindUniqueArgs,
    GroupByArgs,
    GroupByResult,
    ModelResult,
    SelectSubset,
    Subset,
    UpdateArgs,
    UpdateManyAndReturnArgs,
    UpdateManyArgs,
    UpsertArgs,
} from './crud-types';
import type { ClientOptions } from './options';
import type { RuntimePlugin } from './plugin';
import type { ZenStackPromise } from './promise';
import type { ToKysely } from './query-builder';

type TransactionUnsupportedMethods = (typeof TRANSACTION_UNSUPPORTED_METHODS)[number];

/**
 * Transaction isolation levels.
 */
export enum TransactionIsolationLevel {
    ReadUncommitted = 'read uncommitted',
    ReadCommitted = 'read committed',
    RepeatableRead = 'repeatable read',
    Serializable = 'serializable',
    Snapshot = 'snapshot',
}

/**
 * ZenStack client interface.
 */
export type ClientContract<Schema extends SchemaDef> = {
    readonly $schema: Schema;

    /**
     * The client options.
     */
    readonly $options: ClientOptions<Schema>;

    /**
     * Executes a prepared raw query and returns the number of affected rows.
     * @example
     * ```
     * const result = await client.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
     * ```
     */
    $executeRaw(query: TemplateStringsArray, ...values: any[]): ZenStackPromise<Schema, number>;

    /**
     * Executes a raw query and returns the number of affected rows.
     * This method is susceptible to SQL injections.
     * @example
     * ```
     * const result = await client.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
     * ```
     */
    $executeRawUnsafe(query: string, ...values: any[]): ZenStackPromise<Schema, number>;

    /**
     * Performs a prepared raw query and returns the `SELECT` data.
     * @example
     * ```
     * const result = await client.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
     * ```
     */
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): ZenStackPromise<Schema, T>;

    /**
     * Performs a raw query and returns the `SELECT` data.
     * This method is susceptible to SQL injections.
     * @example
     * ```
     * const result = await client.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
     * ```
     */
    $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): ZenStackPromise<Schema, T>;

    /**
     * The current user identity.
     */
    get $auth(): AuthType<Schema> | undefined;

    /**
     * Sets the current user identity.
     */
    $setAuth(auth: AuthType<Schema> | undefined): ClientContract<Schema>;

    /**
     * The Kysely query builder instance.
     */
    readonly $qb: ToKysely<Schema>;

    /**
     * The raw Kysely query builder without any ZenStack enhancements.
     */
    readonly $qbRaw: ToKysely<any>;

    /**
     * Starts an interactive transaction.
     */
    $transaction<T>(
        callback: (tx: Omit<ClientContract<Schema>, TransactionUnsupportedMethods>) => Promise<T>,
        options?: { isolationLevel?: TransactionIsolationLevel },
    ): Promise<T>;

    /**
     * Starts a sequential transaction.
     */
    $transaction<P extends ZenStackPromise<Schema, any>[]>(
        arg: [...P],
        options?: { isolationLevel?: TransactionIsolationLevel },
    ): Promise<UnwrapTuplePromises<P>>;

    /**
     * Returns a new client with the specified plugin installed.
     */
    $use(plugin: RuntimePlugin<Schema>): ClientContract<Schema>;

    /**
     * Returns a new client with the specified plugin removed.
     */
    $unuse(pluginId: string): ClientContract<Schema>;

    /**
     * Returns a new client with all plugins removed.
     */
    $unuseAll(): ClientContract<Schema>;

    /**
     * Disconnects the underlying Kysely instance from the database.
     */
    $disconnect(): Promise<void>;

    /**
     * Pushes the schema to the database. For testing purposes only.
     * @private
     */
    $pushSchema(): Promise<void>;
} & {
    [Key in GetModels<Schema> as Uncapitalize<Key>]: ModelOperations<Schema, Key>;
} & Procedures<Schema>;

/**
 * The contract for a client in a transaction.
 */
export type TransactionClientContract<Schema extends SchemaDef> = Omit<
    ClientContract<Schema>,
    TransactionUnsupportedMethods
>;

type _TypeMap = {
    String: string;
    Int: number;
    Float: number;
    BigInt: bigint;
    Decimal: Decimal;
    Boolean: boolean;
    DateTime: Date;
};

type MapType<Schema extends SchemaDef, T extends string> = T extends keyof _TypeMap
    ? _TypeMap[T]
    : T extends GetModels<Schema>
      ? ModelResult<Schema, T>
      : unknown;

export type Procedures<Schema extends SchemaDef> =
    Schema['procedures'] extends Record<string, ProcedureDef>
        ? {
              $procedures: {
                  [Key in keyof Schema['procedures']]: ProcedureFunc<Schema, Schema['procedures'][Key]>;
              };
          }
        : {};

export type ProcedureFunc<Schema extends SchemaDef, Proc extends ProcedureDef> = (
    ...args: MapProcedureParams<Schema, Proc['params']>
) => Promise<MapType<Schema, Proc['returnType']>>;

type MapProcedureParams<Schema extends SchemaDef, Params> = {
    [P in keyof Params]: Params[P] extends { type: infer U }
        ? OrUndefinedIf<MapType<Schema, U & string>, Params[P] extends { optional: true } ? true : false>
        : never;
};

/**
 * Creates a new ZenStack client instance.
 */
export interface ClientConstructor {
    new <Schema extends SchemaDef>(schema: Schema, options: ClientOptions<Schema>): ClientContract<Schema>;
}

/**
 * CRUD operations.
 */
export type CRUD = 'create' | 'read' | 'update' | 'delete';

//#region Model operations

export interface ModelOperations<Schema extends SchemaDef, Model extends GetModels<Schema>> {
    /**
     * Returns a list of entities.
     * @param args - query args
     * @returns a list of entities
     *
     * @example
     * ```ts
     * // find all users and return all scalar fields
     * await client.user.findMany();
     *
     * // find all users with name 'Alex'
     * await client.user.findMany({
     *     where: {
     *         name: 'Alex'
     *     }
     * });
     *
     * // select fields
     * await client.user.findMany({
     *     select: {
     *         name: true,
     *         email: true,
     *     }
     * }); // result: `Array<{ name: string, email: string }>`
     *
     * // omit fields
     * await client.user.findMany({
     *     omit: {
     *         name: true,
     *     }
     * }); // result: `Array<{ id: number; email: string; ... }>`
     *
     * // include relations (and all scalar fields)
     * await client.user.findMany({
     *     include: {
     *         posts: true,
     *     }
     * }); // result: `Array<{ ...; posts: Post[] }>`
     *
     * // include relations with filter
     * await client.user.findMany({
     *     include: {
     *         posts: {
     *             where: {
     *                 published: true
     *             }
     *         }
     *     }
     * });
     *
     * // pagination and sorting
     * await client.user.findMany({
     *     skip: 10,
     *     take: 10,
     *     orderBy: [{ name: 'asc' }, { email: 'desc' }],
     * });
     *
     * // pagination with cursor (https://www.prisma.io/docs/orm/prisma-client/queries/pagination#cursor-based-pagination)
     * await client.user.findMany({
     *     cursor: { id: 10 },
     *     skip: 1,
     *     take: 10,
     *     orderBy: { id: 'asc' },
     * });
     *
     * // distinct
     * await client.user.findMany({
     *     distinct: ['name']
     * });
     *
     * // count all relations
     * await client.user.findMany({
     *     _count: true,
     * }); // result: `{ _count: { posts: number; ... } }`
     *
     * // count selected relations
     * await client.user.findMany({
     *     _count: { select: { posts: true } },
     * }); // result: `{ _count: { posts: number } }`
     * ```
     */
    findMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>[]>;

    /**
     * Returns a uniquely identified entity.
     * @param args - query args
     * @returns a single entity or null if not found
     * @see {@link findMany}
     */
    findUnique<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T> | null>;

    /**
     * Returns a uniquely identified entity or throws `NotFoundError` if not found.
     * @param args - query args
     * @returns a single entity
     * @see {@link findMany}
     */
    findUniqueOrThrow<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>>;

    /**
     * Returns the first entity.
     * @param args - query args
     * @returns a single entity or null if not found
     * @see {@link findMany}
     */
    findFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T> | null>;

    /**
     * Returns the first entity or throws `NotFoundError` if not found.
     * @param args - query args
     * @returns a single entity
     * @see {@link findMany}
     */
    findFirstOrThrow<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>>;

    /**
     * Creates a new entity.
     * @param args - create args
     * @returns the created entity
     *
     * @example
     * ```ts
     * // simple create
     * await client.user.create({
     *    data: { name: 'Alex', email: 'alex@zenstack.dev' }
     * });
     *
     * // nested create with relation
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { create: { title: 'Hello World' } }
     *    }
     * });
     *
     * // you can use `select`, `omit`, and `include` to control
     * // the fields returned by the query, as with `findMany`
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { create: { title: 'Hello World' } }
     *    },
     *    include: { posts: true }
     * }); // result: `{ id: number; posts: Post[] }`
     *
     * // connect relations
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { connect: { id: 1 } }
     *    }
     * });
     *
     * // connect relations, and create if not found
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: {
     *            connectOrCreate: {
     *                where: { id: 1 },
     *                create: { title: 'Hello World' }
     *            }
     *        }
     *    }
     * });
     * ```
     */
    create<T extends CreateArgs<Schema, Model>>(
        args: SelectSubset<T, CreateArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>>;

    /**
     * Creates multiple entities. Only scalar fields are allowed.
     * @param args - create args
     * @returns count of created entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // create multiple entities
     * await client.user.createMany({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ]
     * });
     *
     * // skip items that cause unique constraint violation
     * await client.user.createMany({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ],
     *     skipDuplicates: true
     * });
     * ```
     */
    createMany<T extends CreateManyArgs<Schema, Model>>(
        args?: SelectSubset<T, CreateManyArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, BatchResult>;

    /**
     * Creates multiple entities and returns them.
     * @param args - create args. See {@link createMany} for input. Use
     * `select` and `omit` to control the fields returned.
     * @returns the created entities
     *
     * @example
     * ```ts
     * // create multiple entities and return selected fields
     * await client.user.createManyAndReturn({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ],
     *     select: { id: true, email: true }
     * });
     * ```
     */
    createManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
        args?: SelectSubset<T, CreateManyAndReturnArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>[]>;

    /**
     * Updates a uniquely identified entity.
     * @param args - update args. See {@link findMany} for how to control
     * fields and relations returned.
     * @returns the updated entity. Throws `NotFoundError` if the entity is not found.
     *
     * @example
     * ```ts
     * // update fields
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { name: 'Alex' }
     * });
     *
     * // connect a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { connect: { id: 1 } } }
     * });
     *
     * // connect relation, and create if not found
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *            connectOrCreate: {
     *                where: { id: 1 },
     *                create: { title: 'Hello World' }
     *            }
     *         }
     *     }
     * });
     *
     * // create many related entities (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             createMany: {
     *                 data: [{ title: 'Hello World' }, { title: 'Hello World 2' }],
     *             }
     *         }
     *     }
     * });
     *
     * // disconnect a one-to-many relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { disconnect: { id: 1 } } }
     * });
     *
     * // disconnect a one-to-one relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { profile: { disconnect: true } }
     * });
     *
     * // replace a relation (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             set: [{ id: 1 }, { id: 2 }]
     *         }
     *     }
     * });
     *
     * // update a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             update: { where: { id: 1 }, data: { title: 'Hello World' } }
     *         }
     *     }
     * });
     *
     * // upsert a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             upsert: {
     *                 where: { id: 1 },
     *                 create: { title: 'Hello World' },
     *                 update: { title: 'Hello World' }
     *             }
     *         }
     *     }
     * });
     *
     * // update many related entities (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             updateMany: {
     *                 where: { published: true },
     *                 data: { title: 'Hello World' }
     *             }
     *         }
     *     }
     * });
     *
     * // delete a one-to-many relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { delete: { id: 1 } } }
     * });
     *
     * // delete a one-to-one relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { profile: { delete: true } }
     * });
     * ```
     */
    update<T extends UpdateArgs<Schema, Model>>(
        args: SelectSubset<T, UpdateArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>>;

    /**
     * Updates multiple entities.
     * @param args - update args. Only scalar fields are allowed for data.
     * @returns count of updated entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // update many entities
     * await client.user.updateMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' }
     * });
     *
     * // limit the number of updated entities
     * await client.user.updateMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     limit: 10
     * });
     */
    updateMany<T extends UpdateManyArgs<Schema, Model>>(
        args: Subset<T, UpdateManyArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, BatchResult>;

    /**
     * Updates multiple entities and returns them.
     * @param args - update args. Only scalar fields are allowed for data.
     * @returns the updated entities
     *
     * @example
     * ```ts
     * // update many entities and return selected fields
     * await client.user.updateManyAndReturn({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     select: { id: true, email: true }
     * }); // result: `Array<{ id: string; email: string }>`
     *
     * // limit the number of updated entities
     * await client.user.updateManyAndReturn({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     limit: 10
     * });
     * ```
     */
    updateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
        args: Subset<T, UpdateManyAndReturnArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>[]>;

    /**
     * Creates or updates an entity.
     * @param args - upsert args
     * @returns the upserted entity
     *
     * @example
     * ```ts
     * // upsert an entity
     * await client.user.upsert({
     *     // `where` clause is used to find the entity
     *     where: { id: 1 },
     *     // `create` clause is used if the entity is not found
     *     create: { email: 'alex@zenstack.dev', name: 'Alex' },
     *     // `update` clause is used if the entity is found
     *     update: { name: 'Alex-new' },
     *     // `select` and `omit` can be used to control the returned fields
     *     ...
     * });
     * ```
     */
    upsert<T extends UpsertArgs<Schema, Model>>(
        args: SelectSubset<T, UpsertArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model, T>>;

    /**
     * Deletes a uniquely identifiable entity.
     * @param args - delete args
     * @returns the deleted entity. Throws `NotFoundError` if the entity is not found.
     *
     * @example
     * ```ts
     * // delete an entity
     * await client.user.delete({
     *     where: { id: 1 }
     * });
     *
     * // delete an entity and return selected fields
     * await client.user.delete({
     *     where: { id: 1 },
     *     select: { id: true, email: true }
     * }); // result: `{ id: string; email: string }`
     * ```
     */
    delete<T extends DeleteArgs<Schema, Model>>(
        args: SelectSubset<T, DeleteArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, ModelResult<Schema, Model>>;

    /**
     * Deletes multiple entities.
     * @param args - delete args
     * @returns count of deleted entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // delete many entities
     * await client.user.deleteMany({
     *     where: { email: { endsWith: '@zenstack.dev' } }
     * });
     *
     * // limit the number of deleted entities
     * await client.user.deleteMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     limit: 10
     * });
     * ```
     */
    deleteMany<T extends DeleteManyArgs<Schema, Model>>(
        args?: Subset<T, DeleteManyArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, BatchResult>;

    /**
     * Counts rows or field values.
     * @param args - count args
     * @returns `number`, or an object containing count of selected relations
     *
     * @example
     * ```ts
     * // count all
     * await client.user.count();
     *
     * // count with a filter
     * await client.user.count({ where: { email: { endsWith: '@zenstack.dev' } } });
     *
     * // count rows and field values
     * await client.user.count({
     *     select: { _all: true, email: true }
     * }); // result: `{ _all: number, email: number }`
     */
    count<T extends CountArgs<Schema, Model>>(
        args?: Subset<T, CountArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, CountResult<Schema, Model, T>>;

    /**
     * Aggregates rows.
     * @param args - aggregation args
     * @returns an object containing aggregated values
     *
     * @example
     * ```ts
     * // aggregate rows
     * await client.profile.aggregate({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     _count: true,
     *     _avg: { age: true },
     *     _sum: { age: true },
     *     _min: { age: true },
     *     _max: { age: true }
     * }); // result: `{ _count: number, _avg: { age: number }, ... }`
     */
    aggregate<T extends AggregateArgs<Schema, Model>>(
        args: Subset<T, AggregateArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, AggregateResult<Schema, Model, T>>;

    /**
     * Groups rows by columns.
     * @param args - groupBy args
     * @returns an object containing grouped values
     *
     * @example
     * ```ts
     * // group by a field
     * await client.profile.groupBy({
     *     by: 'country',
     *     _count: true
     * }); // result: `Array<{ country: string, _count: number }>`
     *
     * // group by multiple fields
     * await client.profile.groupBy({
     *     by: ['country', 'city'],
     *     _count: true
     * }); // result: `Array<{ country: string, city: string, _count: number }>`
     *
     * // group by with sorting, the `orderBy` fields must be in the `by` list
     * await client.profile.groupBy({
     *     by: 'country',
     *     orderBy: { country: 'desc' }
     * });
     *
     * // group by with having (post-aggregation filter), the `having` fields must
     * // be in the `by` list
     * await client.profile.groupBy({
     *     by: 'country',
     *     having: { country: 'US' }
     * });
     */
    groupBy<T extends GroupByArgs<Schema, Model>>(
        args: Subset<T, GroupByArgs<Schema, Model>>,
    ): ZenStackPromise<Schema, GroupByResult<Schema, Model, T>>;
}

//#endregion
