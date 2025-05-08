export class QueryError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class InternalError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class NotFoundError extends Error {
    constructor(model: string) {
        super(`Entity not found for model "${model}"`);
    }
}

export class RejectedByPolicyError extends Error {
    constructor(reason?: string) {
        super(reason ?? `Operation rejected by policy`);
    }
}
