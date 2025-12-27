import { type Handle, type RequestEvent } from '@sveltejs/kit';
import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * SvelteKit request handler options
 */
export interface SvelteKitHandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Url prefix, e.g.: /api
     */
    prefix: string;

    /**
     * Callback for getting a ZenStackClient for the given request
     */
    getClient: (event: RequestEvent) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

/**
 * SvelteKit server hooks handler for handling CRUD requests. This handler is to be used in `hooks.server.ts`.
 * @deprecated use `SvelteKitRouteHandler` instead.
 */
function createHandler<Schema extends SchemaDef>(options: SvelteKitHandlerOptions<Schema>): Handle {
    return async ({ event, resolve }) => {
        if (event.url.pathname.startsWith(options.prefix)) {
            const client = await options.getClient(event);
            if (!client) {
                return new Response(JSON.stringify({ message: 'unable to get ZenStackClient from request context' }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    },
                });
            }

            const query = Object.fromEntries(event.url.searchParams);
            let requestBody: unknown;
            if (event.request.body) {
                try {
                    const text = await event.request.text();
                    if (text) {
                        requestBody = JSON.parse(text);
                    }
                } catch {
                    return new Response(JSON.stringify({ message: 'invalid JSON payload' }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        },
                    });
                }
            }

            const path = event.url.pathname.substring(options.prefix.length);

            try {
                const r = await options.apiHandler.handleRequest({
                    method: event.request.method,
                    path,
                    query,
                    requestBody,
                    client,
                });

                return new Response(JSON.stringify(r.body), {
                    status: r.status,
                    headers: {
                        'content-type': 'application/json',
                    },
                });
            } catch (err) {
                logInternalError(options.apiHandler.log, err);
                return new Response(JSON.stringify({ message: 'An internal server error occurred' }), {
                    status: 500,
                    headers: {
                        'content-type': 'application/json',
                    },
                });
            }
        }

        return resolve(event);
    };
}

export { createHandler as SvelteKitHandler };
