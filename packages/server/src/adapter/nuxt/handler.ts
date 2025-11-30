import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import {
    defineEventHandler,
    getQuery,
    getRouterParams,
    readBody,
    setResponseStatus,
    type H3Event,
    type EventHandlerRequest,
} from 'h3';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * Nuxt request handler options
 */
export interface NuxtHandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request
     */
    getClient: (event: H3Event<EventHandlerRequest>) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

export function createEventHandler<Schema extends SchemaDef>(options: NuxtHandlerOptions<Schema>) {
    return defineEventHandler(async (event) => {
        const client = await options.getClient(event);
        if (!client) {
            setResponseStatus(event, 500);
            return { message: 'unable to get ZenStackClient from request context' };
        }

        const routerParam = getRouterParams(event);
        const query = await getQuery(event);

        let reqBody: unknown;
        if (event.method === 'POST' || event.method === 'PUT' || event.method === 'PATCH') {
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

            setResponseStatus(event, status);
            return body;
        } catch (err) {
            setResponseStatus(event, 500);
            logInternalError(options.apiHandler.log, err);
            return { message: 'An internal server error occurred' };
        }
    });
}
