import type {
    ExpressionBuilder,
    KyselyConfig,
    PostgresDialectConfig,
    SqliteDialectConfig,
} from 'kysely';
import type {
    DataSourceProvider,
    GetModel,
    GetModels,
    SchemaDef,
} from '../schema/schema';
import type { MergeIf } from '../utils/type-utils';
import type { ToKyselySchema } from './query-builder';
import type { Optional } from 'utility-types';

type DialectConfig<Provider extends DataSourceProvider> =
    Provider['type'] extends 'sqlite'
        ? Optional<SqliteDialectConfig, 'database'>
        : Provider extends 'postgresql'
        ? Optional<PostgresDialectConfig, 'pool'>
        : never;

export type ClientOptions<Schema extends SchemaDef> = MergeIf<
    {
        /**
         * Database dialect configuration.
         */
        dialectConfig?: DialectConfig<Schema['provider']>;

        /**
         * Kysely plugins.
         */
        plugins?: KyselyConfig['plugins'];

        /**
         * Logging configuration.
         */
        log?: KyselyConfig['log'];

        /**
         * Feature enablement and configuration.
         */
        features?: FeatureSettings<Schema>;
    },
    {
        computedFields: ComputedFields<Schema>;
    },
    HasComputedFields<Schema>
>;

export type ComputedFields<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as 'computedFields' extends keyof GetModel<
        Schema,
        Model
    >
        ? Model
        : never]: {
        [Field in keyof Schema['models'][Model]['computedFields']]: PrependParameter<
            ExpressionBuilder<
                ToKyselySchema<Schema>,
                GetModel<Schema, Model>['dbTable']
            >,
            Schema['models'][Model]['computedFields'][Field]
        >;
    };
};

export type HasComputedFields<Schema extends SchemaDef> =
    keyof ComputedFields<Schema> extends never ? false : true;

export type FeatureSettings<Schema extends SchemaDef> = {
    policy?: PolicySettings<Schema>;
};

export type PolicySettings<Schema extends SchemaDef> = MergeIf<
    {
        auth?: Record<string, any>;
    },
    {
        externalRules: ExternalRules<Schema>;
    },
    keyof ExternalRules<Schema> extends never ? false : true
>;

type ExternalRules<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as 'externalRules' extends keyof GetModel<
        Schema,
        Model
    >
        ? Model
        : never]: {
        [Rule in keyof Schema['models'][Model]['externalRules']]: PrependParameter<
            ExpressionBuilder<
                ToKyselySchema<Schema>,
                GetModel<Schema, Model>['dbTable']
            >,
            Schema['models'][Model]['externalRules'][Rule]
        >;
    };
};

type PrependParameter<Param, Func> = Func extends (...args: any[]) => infer R
    ? (p: Param, ...args: Parameters<Func>) => R
    : never;
