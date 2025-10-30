import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { TanStackStartOptions } from '.';
import { logInternalError } from '../common';

/**
 * Creates a TanStack Start server route handler which encapsulates ZenStack CRUD operations.
 *
 * @param options Options for initialization
 * @returns A TanStack Start server route handler
 */
export default function factory<Schema extends SchemaDef>(
    options: TanStackStartOptions<Schema>,
): ({ request, params }: { request: Request; params: Record<string, string> }) => Promise<Response> {
    return async ({ request, params }: { request: Request; params: Record<string, string> }) => {
        const client = await options.getClient(request, params);
        if (!client) {
            return new Response(JSON.stringify({ message: 'unable to get ZenStackClient from request context' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }

        const url = new URL(request.url);
        const query = Object.fromEntries(url.searchParams);

        // Extract path from params._splat for catch-all routes
        const path = params['_splat'];

        if (!path) {
            return new Response(JSON.stringify({ message: 'missing path parameter' }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }

        let requestBody: unknown;
        if (request.body) {
            try {
                requestBody = await request.json();
            } catch {
                // noop
            }
        }

        try {
            const r = await options.apiHandler.handleRequest({
                method: request.method!,
                path,
                query,
                requestBody,
                client,
            });
            return new Response(JSON.stringify(r.body), {
                status: r.status,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        } catch (err) {
            logInternalError(options.apiHandler.log, err);
            return new Response(JSON.stringify({ message: 'An internal server error occurred' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }
    };
}
