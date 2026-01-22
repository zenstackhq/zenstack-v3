/**
 * Supported db providers
 */
export const SUPPORTED_PROVIDERS = ['sqlite', 'postgresql', 'mysql'];

/**
 * All scalar types
 */
export const SCALAR_TYPES = ['String', 'Int', 'Float', 'Decimal', 'BigInt', 'Boolean', 'Bytes', 'DateTime'];

/**
 * Name of standard library module
 */
export const STD_LIB_MODULE_NAME = 'stdlib.zmodel';

/**
 * Name of module contributed by plugins
 */
export const PLUGIN_MODULE_NAME = 'plugin.zmodel';

/**
 * Validation issues
 */
export enum IssueCodes {
    MissingOppositeRelation = 'miss-opposite-relation',
}

/**
 * Expression context
 */
export enum ExpressionContext {
    DefaultValue = 'DefaultValue',
    AccessPolicy = 'AccessPolicy',
    ValidationRule = 'ValidationRule',
    Index = 'Index',
}

/**
 * Database providers that support list field types.
 */
export const DB_PROVIDERS_SUPPORTING_LIST_TYPE = ['postgresql'];
