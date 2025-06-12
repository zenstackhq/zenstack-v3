/* eslint-disable @typescript-eslint/ban-types */

import type { Decimal } from 'decimal.js';
import {
    type AuthType,
    type GetModels,
    type ProcedureDef,
    type SchemaDef,
} from '../schema/schema';
import type { OrUndefinedIf } from '../utils/type-utils';
import type { ModelOperations, ModelResult } from './crud-types';
import type { ClientOptions, HasComputedFields } from './options';
import type { RuntimePlugin } from './plugin';
import type { ToKysely } from './query-builder';

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
     * Starts a transaction.
     */
    $transaction<T>(
        callback: (tx: ClientContract<Schema>) => Promise<T>
    ): Promise<T>;

    /**
     * Returns a new client with the specified plugin installed.
     */
    $use(plugin: RuntimePlugin<Schema>): ClientContract<Schema>;

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
     */
    $pushSchema(): Promise<void>;
} & {
    [Key in GetModels<Schema> as Uncapitalize<Key>]: ModelOperations<
        Schema,
        Key
    >;
} & Procedures<Schema>;

type MapType<Schema extends SchemaDef, T extends string> = T extends 'String'
    ? string
    : T extends 'Int'
    ? number
    : T extends 'Float'
    ? number
    : T extends 'BigInt'
    ? bigint
    : T extends 'Decimal'
    ? Decimal
    : T extends 'Boolean'
    ? boolean
    : T extends 'DateTime'
    ? Date
    : T extends GetModels<Schema>
    ? ModelResult<Schema, T>
    : unknown;

export type Procedures<Schema extends SchemaDef> =
    Schema['procedures'] extends Record<string, ProcedureDef>
        ? {
              $procedures: {
                  [Key in keyof Schema['procedures']]: ProcedureFunc<
                      Schema,
                      Schema['procedures'][Key]
                  >;
              };
          }
        : {};

export type ProcedureFunc<
    Schema extends SchemaDef,
    Proc extends ProcedureDef
> = (
    ...args: MapProcedureParams<Schema, Proc['params']>
) => Promise<MapType<Schema, Proc['returnType']>>;

type MapProcedureParams<Schema extends SchemaDef, Params> = {
    [P in keyof Params]: Params[P] extends { type: infer U }
        ? OrUndefinedIf<
              MapType<Schema, U & string>,
              Params[P] extends { optional: true } ? true : false
          >
        : never;
};

/**
 * Creates a new ZenStack client instance.
 */
export interface ClientConstructor {
    new <Schema extends SchemaDef>(
        schema: HasComputedFields<Schema> extends false ? Schema : never
    ): ClientContract<Schema>;
    new <Schema extends SchemaDef>(
        schema: Schema,
        options: ClientOptions<Schema>
    ): ClientContract<Schema>;
}

/**
 * CRUD operations.
 */
export type CRUD = 'create' | 'read' | 'update' | 'delete';
