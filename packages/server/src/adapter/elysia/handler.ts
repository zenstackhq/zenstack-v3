import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { Elysia, type Context as ElysiaContext } from 'elysia';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * Options for initializing an Elysia middleware.
 */
export interface ElysiaOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback method for getting a ZenStackClient instance for the given request context.
     */
    getClient: (context: ElysiaContext) => Promise<ClientContract<Schema>> | ClientContract<Schema>;

    /**
     * Optional base path to strip from the request path before passing to the API handler.
     */
    basePath?: string;
}

/**
 * Creates an Elysia middleware handler for ZenStack.
 * This handler provides automatic CRUD APIs through Elysia's routing system.
 */
export function createElysiaHandler<Schema extends SchemaDef>(options: ElysiaOptions<Schema>) {
    return async (app: Elysia) => {
        app.all('/*', async (ctx: ElysiaContext) => {
            const { query, body, set, request } = ctx;
            const client = await options.getClient(ctx);
            if (!client) {
                set.status = 500;
                return {
                    message: 'unable to get ZenStackClient from request context',
                };
            }

            const url = new URL(request.url);
            let path = url.pathname;

            if (options.basePath && path.startsWith(options.basePath)) {
                path = path.slice(options.basePath.length);
                if (!path.startsWith('/')) {
                    path = '/' + path;
                }
            }

            if (!path || path === '/') {
                set.status = 400;
                return {
                    message: 'missing path parameter',
                };
            }

            try {
                const r = await options.apiHandler.handleRequest({
                    method: request.method,
                    path,
                    query,
                    requestBody: body,
                    client,
                });

                set.status = r.status;
                return r.body;
            } catch (err) {
                set.status = 500;
                logInternalError(options.apiHandler.log, err);
                return {
                    message: 'An internal server error occurred',
                };
            }
        });

        return app;
    };
}
