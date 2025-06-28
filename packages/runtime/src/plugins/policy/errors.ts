/**
 * Error thrown when an operation is rejected by access policy.
 */
export class RejectedByPolicyError extends Error {
    constructor(
        public readonly model: string | undefined,
        public readonly reason?: string,
    ) {
        super(reason ?? `Operation rejected by policy${model ? ': ' + model : ''}`);
    }
}
