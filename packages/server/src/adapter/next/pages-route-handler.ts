import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { PageRouteRequestHandlerOptions } from '.';
import { logInternalError } from '../common';

/**
 * Creates a Next.js API endpoint "pages" router request handler that handles ZenStack CRUD requests.
 *
 * @param options Options for initialization
 * @returns An API endpoint request handler
 */
export default function factory<Schema extends SchemaDef>(
    options: PageRouteRequestHandlerOptions<Schema>,
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        const client = await options.getClient(req, res);
        if (!client) {
            res.status(500).json({ message: 'unable to get ZenStackClient from request context' });
            return;
        }

        if (!req.query['path']) {
            res.status(400).json({ message: 'missing path parameter' });
            return;
        }
        const path = (req.query['path'] as string[]).join('/');

        try {
            const r = await options.apiHandler.handleRequest({
                method: req.method!,
                path,
                query: req.query as Record<string, string | string[]>,
                requestBody: req.body,
                client,
            });
            res.status(r.status).send(r.body);
        } catch (err) {
            logInternalError(options.apiHandler.log, err);
            res.status(500).send({ message: 'An internal server error occurred' });
        }
    };
}
