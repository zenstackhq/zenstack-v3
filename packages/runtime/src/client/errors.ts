/**
 * Error thrown when input validation fails.
 */
export class InputValidationError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
    }
}

/**
 * Error thrown when a query fails.
 */
export class QueryError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
    }
}

/**
 * Error thrown when an internal error occurs.
 */
export class InternalError extends Error {
    constructor(message: string) {
        super(message);
    }
}

/**
 * Error thrown when an entity is not found.
 */
export class NotFoundError extends Error {
    constructor(model: string) {
        super(`Entity not found for model "${model}"`);
    }
}
