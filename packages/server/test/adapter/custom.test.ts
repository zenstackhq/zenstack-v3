import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { describe, expect, it, vi } from 'vitest';
import { logInternalError, type CommonAdapterOptions } from '../../src/adapter/common';
import { type ApiHandler, type RequestContext, type Response } from '../../src/types';

type AdapterRequest<Schema extends SchemaDef> = {
    method: string;
    path: string;
    query?: Record<string, string | string[]>;
    body?: unknown;
    client: ClientContract<Schema>;
};

class RecordingHandler implements ApiHandler<SchemaDef> {
    constructor(
        protected readonly schemaDef: SchemaDef,
        protected readonly response: Response,
        protected readonly logger?: (...args: any[]) => void,
    ) {}

    readonly contexts: Array<RequestContext<SchemaDef>> = [];

    get schema(): SchemaDef {
        return this.schemaDef;
    }

    get log() {
        return this.logger;
    }

    async handleRequest(context: RequestContext<SchemaDef>): Promise<Response> {
        this.contexts.push(context);
        return this.response;
    }
}

class ThrowingHandler implements ApiHandler<SchemaDef> {
    constructor(protected readonly schemaDef: SchemaDef, protected readonly logger: (...args: any[]) => void) {}

    get schema(): SchemaDef {
        return this.schemaDef;
    }

    get log() {
        return this.logger;
    }

    async handleRequest(): Promise<Response> {
        throw new Error('adapter failure');
    }
}

function createCustomAdapter<Schema extends SchemaDef>(
    options: CommonAdapterOptions<Schema>,
): (request: AdapterRequest<Schema>) => Promise<Response> {
    return async (request) => {
        const context: RequestContext<Schema> = {
            client: request.client,
            method: request.method,
            path: request.path,
            query: request.query,
            requestBody: request.body,
        };

        try {
            return await options.apiHandler.handleRequest(context);
        } catch (err) {
            logInternalError(options.apiHandler.log, err);
            throw err;
        }
    };
}

describe('Custom adapter test', () => {
    const schema = {} as SchemaDef;
    const client = { $schema: schema } as unknown as ClientContract<SchemaDef>;

    it('delegates to api handler', async () => {
        const response: Response = { status: 201, body: { ok: true } };
        const handler = new RecordingHandler(schema, response);
        const adapter = createCustomAdapter({ apiHandler: handler });

        const result = await adapter({
            method: 'get',
            path: '/something',
            query: { foo: 'bar' },
            body: { value: 1 },
            client,
        });

        expect(result).toEqual(response);
        expect(handler.contexts).toHaveLength(1);
        const captured = handler.contexts[0];
        expect(captured.method).toBe('get');
        expect(captured.path).toBe('/something');
        expect(captured.query).toEqual({ foo: 'bar' });
        expect(captured.requestBody).toEqual({ value: 1 });
        expect(captured.client).toBe(client);
    });

    it('logs internal error when handler throws', async () => {
        const logger = vi.fn();
        const handler = new ThrowingHandler(schema, logger);
        const adapter = createCustomAdapter({ apiHandler: handler });

        await expect(
            adapter({
                method: 'post',
                path: '/fail',
                client,
            }),
        ).rejects.toThrow('adapter failure');
        expect(logger).toHaveBeenCalledTimes(1);
        const call = logger.mock.calls[0];
        expect(call[0]).toBe('error');
        expect(call[1]).toContain('An unhandled error occurred while processing the request: Error: adapter failure');
    });
});
