/**
 * Error thrown when an operation is rejected by access policy.
 */
export class RejectedByPolicyError extends Error {
    constructor(reason?: string) {
        super(reason ?? `Operation rejected by policy`);
    }
}
