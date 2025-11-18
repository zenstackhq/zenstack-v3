import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger function
 */
export type Logger = (level: LogLevel, message: string, error?: unknown) => void;

/**
 * Log configuration
 */
export type LogConfig = ReadonlyArray<LogLevel> | Logger;

/**
 * API request context
 */
export type RequestContext<Schema extends SchemaDef> = {
    /**
     * The ZenStackClient instance
     */
    client: ClientContract<Schema>;

    /**
     * The HTTP method
     */
    method: string;

    /**
     * The request endpoint path (excluding any prefix)
     */
    path: string;

    /**
     * The query parameters
     */
    query?: Record<string, string | string[]>;

    /**
     * The request body object
     */
    requestBody?: unknown;
};

/**
 * API response
 */
export type Response = {
    /**
     * HTTP status code
     */
    status: number;

    /**
     * Response body
     */
    body: unknown;
};

/**
 * Framework-agnostic API handler.
 */
export interface ApiHandler<Schema extends SchemaDef = SchemaDef> {
    /**
     * The schema associated with this handler.
     */
    get schema(): Schema;

    /**
     * Logging configuration.
     */
    get log(): LogConfig | undefined;

    /**
     * Handle an API request.
     */
    handleRequest(context: RequestContext<Schema>): Promise<Response>;
}
