import type { Expression, ExpressionBuilder, KyselyConfig, PostgresDialectConfig, SqliteDialectConfig } from 'kysely';
import type { Optional } from 'utility-types';
import type { DataSourceProvider, GetModel, GetModels, ProcedureDef, SchemaDef } from '../schema';
import type { PrependParameter } from '../utils/type-utils';
import type { ClientContract, CRUD, ProcedureFunc } from './contract';
import type { BaseCrudDialect } from './crud/dialects/base';
import type { RuntimePlugin } from './plugin';
import type { ToKyselySchema } from './query-builder';

type DialectConfig<Provider extends DataSourceProvider> = Provider['type'] extends 'sqlite'
    ? Optional<SqliteDialectConfig, 'database'>
    : Provider['type'] extends 'postgresql'
      ? Optional<PostgresDialectConfig, 'pool'>
      : never;

export type ZModelFunctionContext<Schema extends SchemaDef> = {
    dialect: BaseCrudDialect<Schema>;
    model: GetModels<Schema>;
    operation: CRUD;
};

export type ZModelFunction<Schema extends SchemaDef> = (
    eb: ExpressionBuilder<ToKyselySchema<Schema>, keyof ToKyselySchema<Schema>>,
    args: Expression<any>[],
    context: ZModelFunctionContext<Schema>,
) => Expression<unknown>;

/**
 * ZenStack client options.
 */
export type ClientOptions<Schema extends SchemaDef> = {
    /**
     * Database dialect configuration.
     */
    dialectConfig: DialectConfig<Schema['provider']>;

    /**
     * Custom function definitions.
     */
    functions?: Record<string, ZModelFunction<Schema>>;

    /**
     * Plugins.
     */
    plugins?: RuntimePlugin<Schema>[];

    /**
     * Logging configuration.
     */
    log?: KyselyConfig['log'];
} & (HasComputedFields<Schema> extends true
    ? {
          /**
           * Computed field definitions.
           */
          computedFields: ComputedFieldsOptions<Schema>;
      }
    : {}) &
    (HasProcedures<Schema> extends true
        ? {
              /**
               * Custom procedure definitions.
               */
              procedures: ProceduresOptions<Schema>;
          }
        : {});

export type ComputedFieldsOptions<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as 'computedFields' extends keyof GetModel<Schema, Model> ? Model : never]: {
        [Field in keyof Schema['models'][Model]['computedFields']]: PrependParameter<
            ExpressionBuilder<ToKyselySchema<Schema>, Model>,
            Schema['models'][Model]['computedFields'][Field]
        >;
    };
};

export type HasComputedFields<Schema extends SchemaDef> =
    string extends GetModels<Schema> ? false : keyof ComputedFieldsOptions<Schema> extends never ? false : true;

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
