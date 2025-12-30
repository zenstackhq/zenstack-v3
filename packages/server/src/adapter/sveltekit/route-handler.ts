import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * SvelteKit route handler options
 */
export interface SvelteKitRouteHandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request event
     */
    getClient: (event: RequestEvent) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

/**
 * SvelteKit server route handler for handling CRUD requests. This handler is to be used in a `+server.ts`
 * API route file.
 */
function createHandler<Schema extends SchemaDef>(options: SvelteKitRouteHandlerOptions<Schema>): RequestHandler {
    return async (event) => {
        const client = await options.getClient(event);
        if (!client) {
            return json({ message: 'unable to get ZenStackClient from request context' }, { status: 400 });
        }

        const query = Object.fromEntries(event.url.searchParams);
        let requestBody: unknown;
        if (event.request.body) {
            try {
                requestBody = await event.request.json();
            } catch {
                return json({ message: 'invalid JSON payload' }, { status: 400 });
            }
        }

        const path = event.params['path'];
        if (!path) {
            return json({ message: 'route is missing path parameter' }, { status: 400 });
        }

        try {
            const r = await options.apiHandler.handleRequest({
                method: event.request.method,
                path,
                query,
                requestBody,
                client,
            });

            return json(r.body, { status: r.status });
        } catch (err) {
            logInternalError(options.apiHandler.log, err);
            return json({ message: 'An internal server error occurred' }, { status: 500 });
        }
    };
}

export { createHandler as SvelteKitRouteHandler };
