import type { SchemaDef } from '@zenstackhq/orm/schema';
import { NextRequest, NextResponse } from 'next/server';
import type { AppRouteRequestHandlerOptions } from '.';

type Context = { params: Promise<{ path: string[] }> };

/**
 * Creates a Next.js "app router" API route request handler that handles ZenStack CRUD requests.
 *
 * @param options Options for initialization
 * @returns An API route request handler
 */
export default function factory<Schema extends SchemaDef>(
    options: AppRouteRequestHandlerOptions<Schema>,
): (req: NextRequest, context: Context) => Promise<NextResponse> {
    return async (req: NextRequest, context: Context) => {
        const client = await options.getClient(req);
        if (!client) {
            return NextResponse.json({ message: 'unable to get ZenStackClient from request context' }, { status: 500 });
        }

        let params: Awaited<Context['params']>;
        const url = new URL(req.url);
        const query = Object.fromEntries(url.searchParams);

        try {
            params = await context.params;
        } catch {
            return NextResponse.json({ message: 'Failed to resolve request parameters' }, { status: 500 });
        }

        if (!params.path) {
            return NextResponse.json(
                { message: 'missing path parameter' },
                {
                    status: 400,
                },
            );
        }
        const path = params.path.join('/');

        let requestBody: unknown;
        if (req.body) {
            try {
                requestBody = await req.json();
            } catch {
                // noop
            }
        }

        try {
            const r = await options.apiHandler.handleRequest({
                method: req.method!,
                path,
                query,
                requestBody,
                client,
            });
            return NextResponse.json(r.body, { status: r.status });
        } catch (err) {
            return NextResponse.json({ message: `An unhandled error occurred: ${err}` }, { status: 500 });
        }
    };
}
