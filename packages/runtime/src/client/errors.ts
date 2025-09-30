/**
 * Base for all ZenStack runtime errors.
 */
export class ZenStackError extends Error {}

/**
 * Error thrown when input validation fails.
 */
export class InputValidationError extends ZenStackError {
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
    }
}

/**
 * Error thrown when a query fails.
 */
export class QueryError extends ZenStackError {
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
    }
}

/**
 * Error thrown when an internal error occurs.
 */
export class InternalError extends ZenStackError {}

/**
 * Error thrown when an entity is not found.
 */
export class NotFoundError extends ZenStackError {
    constructor(model: string, details?: string) {
        super(`Entity not found for model "${model}"${details ? `: ${details}` : ''}`);
    }
}
