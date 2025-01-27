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
