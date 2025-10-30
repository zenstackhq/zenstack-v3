import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import {
    H3Event,
    defineEventHandler,
    getQuery,
    getRouterParams,
    readBody,
    type EventHandlerRequest
} from 'h3';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * Nuxt request handler options
 */
export interface HandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request
     */
    getClient: (event: H3Event<EventHandlerRequest>) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

export function createEventHandler<Schema extends SchemaDef>(options: HandlerOptions<Schema>) {
    return defineEventHandler(async (event) => {
        const client = await options.getClient(event);
        if (!client) {
            event.res.status = 500;
            return { message: 'unable to get ZenStackClient from request context' };
        }

        const routerParam = getRouterParams(event);
        const query = await getQuery(event);

        let reqBody: unknown;
        if (event.req.method === 'POST' || event.req.method === 'PUT' || event.req.method === 'PATCH') {
            reqBody = await readBody(event);
        }

        try {
            const { status, body } = await options.apiHandler.handleRequest({
                method: event.method,
                path: routerParam['_']!,
                query: query as Record<string, string | string[]>,
                requestBody: reqBody,
                client,
            });

            event.res.status = status;
            return body;
        } catch (err) {
            event.res.status = 500;
            logInternalError(options.apiHandler.log, err);
            return { message: 'An internal server error occurred' };
        }
    });
}
