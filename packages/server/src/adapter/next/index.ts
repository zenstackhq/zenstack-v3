import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { NextRequest } from 'next/server';
import type { CommonAdapterOptions } from '../common';
import { default as AppRouteHandler } from './app-route-handler';
import { default as PagesRouteHandler } from './pages-route-handler';

/**
 * Options for initializing a Next.js API endpoint request handler.
 */
export interface PageRouteRequestHandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request
     */
    getClient: (req: NextApiRequest, res: NextApiResponse) => ClientContract<Schema> | Promise<ClientContract<Schema>>;

    /**
     * Use app dir or not
     */
    useAppDir?: false | undefined;
}

/**
 * Options for initializing a Next.js 13 app dir API route handler.
 */
export interface AppRouteRequestHandlerOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request.
     */
    getClient: (req: NextRequest) => ClientContract<Schema> | Promise<ClientContract<Schema>>;

    /**
     * Use app dir or not
     */
    useAppDir: true;
}

/**
 * Creates a Next.js API route handler.
 */
export function NextRequestHandler<Schema extends SchemaDef>(
    options: PageRouteRequestHandlerOptions<Schema>,
): ReturnType<typeof PagesRouteHandler>;
export function NextRequestHandler<Schema extends SchemaDef>(
    options: AppRouteRequestHandlerOptions<Schema>,
): ReturnType<typeof AppRouteHandler>;
export function NextRequestHandler<Schema extends SchemaDef>(
    options: PageRouteRequestHandlerOptions<Schema> | AppRouteRequestHandlerOptions<Schema>,
) {
    if (options.useAppDir === true) {
        return AppRouteHandler(options);
    } else {
        return PagesRouteHandler(options);
    }
}
