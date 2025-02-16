import type {
    ExpressionBuilder,
    KyselyConfig,
    PostgresDialectConfig,
    SqliteDialectConfig,
} from 'kysely';
import type { DataSourceProvider, SchemaDef } from '../schema/schema';
import type { MergeIf } from '../utils/type-utils';
import type { toKysely } from './query-builder';

type DialectConfig<Provider extends DataSourceProvider> =
    Provider extends 'sqlite'
        ? SqliteDialectConfig
        : Provider extends 'postgresql'
        ? PostgresDialectConfig
        : never;

export type ClientOptions<Schema extends SchemaDef> = {
    /**
     * Database dialect configuration.
     */
    dialectConfig: DialectConfig<Schema['provider']>;

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
};

export type FeatureSettings<Schema extends SchemaDef> = {
    policy?: PolicyFeatureSettings<Schema>;
};

export type PolicyFeatureSettings<Schema extends SchemaDef> = MergeIf<
    {
        auth?: Record<string, any>;
    },
    {
        externalRules: ExternalRules<Schema>;
    },
    keyof ExternalRules<Schema> extends never ? false : true
>;

type ExternalRules<Schema extends SchemaDef, KyselyDB = toKysely<Schema>> = {
    [Model in keyof Schema['models'] as 'externalRules' extends keyof Schema['models'][Model]
        ? Model
        : never]: {
        [Rule in keyof Schema['models'][Model]['externalRules']]: PrependParameter<
            ExpressionBuilder<
                KyselyDB,
                Model extends keyof KyselyDB ? Model : never
            >,
            Schema['models'][Model]['externalRules'][Rule]
        >;
    };
};

type PrependParameter<Param, Func> = Func extends (...args: any[]) => infer R
    ? (p: Param, ...args: Parameters<Func>) => R
    : never;
