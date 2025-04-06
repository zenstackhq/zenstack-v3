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
    SchemaDef,
} from '../schema/schema';
import type { MergeIf, PrependParameter } from '../utils/type-utils';
import type { RuntimePlugin } from './plugin';
import type { ToKyselySchema } from './query-builder';

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

        plugins?: RuntimePlugin<Schema>[];

        /**
         * Logging configuration.
         */
        log?: KyselyConfig['log'];
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

// // @ts-ignore
// export type FeatureSettings<Schema extends SchemaDef> = {};
