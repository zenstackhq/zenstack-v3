import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { Handler, Request, Response } from 'express';
import { logInternalError, type CommonAdapterOptions } from '../common';

/**
 * Express middleware options
 */
export interface ExpressMiddlewareOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {
    /**
     * Callback for getting a ZenStackClient for the given request
     */
    getClient: (req: Request, res: Response) => ClientContract<Schema> | Promise<ClientContract<Schema>>;

    /**
     * Controls if the middleware directly sends a response. If set to false,
     * the response is stored in the `res.locals` object and then the middleware
     * calls the `next()` function to pass the control to the next middleware.
     * Subsequent middleware or request handlers need to make sure to send
     * a response.
     *
     * Defaults to true;
     */
    sendResponse?: boolean;
}

/**
 * Creates an Express middleware for handling CRUD requests.
 */
const factory = <Schema extends SchemaDef>(options: ExpressMiddlewareOptions<Schema>): Handler => {
    const requestHandler = options.apiHandler;

    return async (request, response, next) => {
        const client = await options.getClient(request, response);
        const { sendResponse } = options;

        if (sendResponse === false && !client) {
            throw new Error('unable to get ZenStackClient from request context');
        }

        if (!client) {
            return response.status(500).json({ message: 'unable to get ZenStackClient from request context' });
        }

        // express converts query parameters with square brackets into object
        // e.g.: filter[foo]=bar is parsed to { filter: { foo: 'bar' } }
        // we need to revert this behavior and reconstruct params from original URL
        const url = request.protocol + '://' + request.get('host') + request.originalUrl;
        const searchParams = new URL(url).searchParams;
        const query = Object.fromEntries(searchParams);

        try {
            const r = await requestHandler.handleRequest({
                method: request.method,
                path: request.path,
                query,
                requestBody: request.body,
                client,
            });
            if (sendResponse === false) {
                // attach response and pass control to the next middleware
                response.locals['zenstack'] = {
                    status: r.status,
                    body: r.body,
                };
                return next();
            }
            return response.status(r.status).json(r.body);
        } catch (err) {
            if (sendResponse === false) {
                throw err;
            }
            logInternalError(options.apiHandler.log, err);
            return response.status(500).json({ message: `An internal server error occurred` });
        }
    };
};

export default factory;

export { factory as ZenStackMiddleware };
