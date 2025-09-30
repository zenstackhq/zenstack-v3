import { ZenStackError } from '../../client';

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
