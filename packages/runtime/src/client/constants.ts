/**
 * The comment prefix for annotation generated Kysely queries with context information.
 */
export const CONTEXT_COMMENT_PREFIX = '-- $$context:';

/**
 * The types of fields that are numeric.
 */
export const NUMERIC_FIELD_TYPES = ['Int', 'Float', 'BigInt', 'Decimal'];

/**
 * Client API methods that are not supported in transactions.
 */
export const TRANSACTION_UNSUPPORTED_METHODS = ['$transaction', '$disconnect', '$use'] as const;

/**
 * Prefix for JSON field used to store joined delegate rows.
 */
export const DELEGATE_JOINED_FIELD_PREFIX = '$delegate$';
