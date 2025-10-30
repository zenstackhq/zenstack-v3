import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { CommonAdapterOptions } from '../common';
import { default as Handler } from './handler';

/**
 * Options for initializing a TanStack Start server route handler.
 */
export interface TanStackStartOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback method for getting a ZenStackClient instance for the given request and params.
     */
    getClient: (
        request: Request,
        params: Record<string, string>,
    ) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

/**
 * Creates a TanStack Start server route handler.
 * @see https://zenstack.dev/docs/reference/server-adapters/tanstack-start
 */
export function TanStackStartHandler<Schema extends SchemaDef>(
    options: TanStackStartOptions<Schema>,
): ReturnType<typeof Handler> {
    return Handler(options);
}

export default TanStackStartHandler;
