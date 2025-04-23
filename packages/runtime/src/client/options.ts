import type {
    ExpressionBuilder,
    KyselyConfig,
    PostgresDialectConfig,
    SqliteDialectConfig,
} from 'kysely';
import type { Optional } from 'utility-types';
import type {
    DataSourceProvider,
    GetModel,
    GetModels,
    ProcedureDef,
    SchemaDef,
} from '../schema/schema';
import type { PrependParameter } from '../utils/type-utils';
import type { ClientContract, ProcedureFunc } from './contract';
import type { RuntimePlugin } from './plugin';
import type { ToKyselySchema } from './query-builder';

type DialectConfig<Provider extends DataSourceProvider> =
    Provider['type'] extends 'sqlite'
        ? Optional<SqliteDialectConfig, 'database'>
        : Provider extends 'postgresql'
        ? Optional<PostgresDialectConfig, 'pool'>
        : never;

export type ClientOptions<Schema extends SchemaDef> = {
    /**
     * Database dialect configuration.
     */
    dialectConfig?: DialectConfig<Schema['provider']>;

    plugins?: RuntimePlugin<Schema>[];

    /**
     * Logging configuration.
     */
    log?: KyselyConfig['log'];
} & (HasComputedFields<Schema> extends true
    ? {
          computedFields: ComputedFieldsOptions<Schema>;
      }
    : {}) &
    (HasProcedures<Schema> extends true
        ? {
              procedures: ProceduresOptions<Schema>;
          }
        : {});

export type ComputedFieldsOptions<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as 'computedFields' extends keyof GetModel<
        Schema,
        Model
    >
        ? Model
        : never]: {
        [Field in keyof Schema['models'][Model]['computedFields']]: PrependParameter<
            ExpressionBuilder<ToKyselySchema<Schema>, Model>,
            Schema['models'][Model]['computedFields'][Field]
        >;
    };
};

export type HasComputedFields<Schema extends SchemaDef> =
    keyof ComputedFieldsOptions<Schema> extends never ? false : true;

export type ProceduresOptions<Schema extends SchemaDef> = Schema extends {
    procedures: Record<string, ProcedureDef>;
}
    ? {
          [Key in keyof Schema['procedures']]: PrependParameter<
              ClientContract<Schema>,
              ProcedureFunc<Schema, Schema['procedures'][Key]>
          >;
      }
    : {};

export type HasProcedures<Schema extends SchemaDef> = Schema extends {
    procedures: Record<string, ProcedureDef>;
}
    ? true
    : false;
