import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * Options for initializing a Hono middleware.
 */
export interface HonoOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback method for getting a ZenStackClient instance for the given request.
     */
    getClient: (ctx: Context) => Promise<ClientContract<Schema>> | ClientContract<Schema>;
}

export function createHonoHandler<Schema extends SchemaDef>(options: HonoOptions<Schema>): MiddlewareHandler {
    return async (ctx) => {
        const client = await options.getClient(ctx);
        if (!client) {
            return ctx.json({ message: 'unable to get ZenStackClient from request context' }, 500);
        }

        const url = new URL(ctx.req.url);
        const query = Object.fromEntries(url.searchParams);

        const path = ctx.req.path.substring(ctx.req.routePath.length - 1);
        if (!path) {
            return ctx.json({ message: 'missing path parameter' }, 400);
        }

        let requestBody: unknown;
        if (ctx.req.raw.body) {
            try {
                requestBody = await ctx.req.json();
            } catch {
                // noop
            }
        }

        try {
            const r = await options.apiHandler.handleRequest({
                method: ctx.req.method,
                path,
                query,
                requestBody,
                client,
            });
            return ctx.json(r.body as object, r.status as ContentfulStatusCode);
        } catch (err) {
            logInternalError(options.apiHandler.log, err);
            return ctx.json({ message: `An internal server error occurred` }, 500);
        }
    };
}
