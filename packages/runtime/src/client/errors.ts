/**
 * Base for all ZenStack runtime errors.
 */
export class ZenStackError extends Error {}

/**
 * Error thrown when input validation fails.
 */
export class InputValidationError extends ZenStackError {
    constructor(
        public readonly model: string,
        message: string,
        cause?: unknown,
    ) {
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
    constructor(
        public readonly model: string,
        details?: string,
    ) {
        super(`Entity not found for model "${model}"${details ? `: ${details}` : ''}`);
    }
}

/**
 * Reason code for policy rejection.
 */
export enum RejectedByPolicyReason {
    /**
     * Rejected because the operation is not allowed by policy.
     */
    NO_ACCESS = 'no-access',

    /**
     * Rejected because the result cannot be read back after mutation due to policy.
     */
    CANNOT_READ_BACK = 'cannot-read-back',

    /**
     * Other reasons.
     */
    OTHER = 'other',
}

/**
 * Error thrown when an operation is rejected by access policy.
 */
export class RejectedByPolicyError extends ZenStackError {
    constructor(
        public readonly model: string | undefined,
        public readonly reason: RejectedByPolicyReason = RejectedByPolicyReason.NO_ACCESS,
        message?: string,
    ) {
        super(message ?? `Operation rejected by policy${model ? ': ' + model : ''}`);
    }
}
