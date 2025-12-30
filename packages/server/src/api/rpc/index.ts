import { lowerCaseFirst, safeJSONStringify } from '@zenstackhq/common-helpers';
import { ORMError, ORMErrorReason, type ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import SuperJSON from 'superjson';
import { match } from 'ts-pattern';
import type { ApiHandler, LogConfig, RequestContext, Response } from '../../types';
import { log, registerCustomSerializers } from '../utils';

registerCustomSerializers();

const BUILT_IN_OPERATIONS = new Set([
    'create',
    'createMany',
    'createManyAndReturn',
    'upsert',
    'findFirst',
    'findUnique',
    'findMany',
    'aggregate',
    'groupBy',
    'count',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'delete',
    'deleteMany',
]);

const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class RPCBadInputErrorResponse extends Error {}

export class RPCGenericErrorResponse extends Error {}

export type RPCCustomOperationContext<Schema extends SchemaDef = SchemaDef> = RequestContext<Schema> & {
    model: string;
    operation: string;
    args?: unknown;
};

export type RPCCustomOperation<Schema extends SchemaDef = SchemaDef> = (
    args: RPCCustomOperationContext<Schema>,
) => Promise<Response> | Response;

/**
 * Options for {@link RPCApiHandler}
 */
export type RPCApiHandlerOptions<Schema extends SchemaDef = SchemaDef> = {
    /**
     * The schema
     */
    schema: Schema;

    /**
     * Logging configuration
     */
    log?: LogConfig;

    /**
     * Custom operations callable via RPC path. Keys must be valid JS identifiers and must not
     * overlap with built-in operations.
     */
    customOperations?: Record<string, RPCCustomOperation<Schema>>;
};

/**
 * RPC style API request handler that mirrors the ZenStackClient API
 */
export class RPCApiHandler<Schema extends SchemaDef = SchemaDef> implements ApiHandler<Schema> {
    constructor(private readonly options: RPCApiHandlerOptions<Schema>) {
        this.validateCustomOperations();
    }

    get schema(): Schema {
        return this.options.schema;
    }

    get log(): LogConfig | undefined {
        return this.options.log;
    }

    async handleRequest({ client, method, path, query, requestBody }: RequestContext<Schema>): Promise<Response> {
        const parts = path.split('/').filter((p) => !!p);
        const op = parts.pop();
        let model = parts.pop();

        if (parts.length !== 0 || !op || !model) {
            return this.makeBadInputErrorResponse('invalid request path');
        }

        model = lowerCaseFirst(model);
        method = method.toUpperCase();
        let args: unknown;
        let resCode = 200;

        const { query: normalizedQuery, qArgs, error: queryError } = this.normalizeQuery(query);
        if (queryError) {
            return this.makeBadInputErrorResponse(queryError);
        }

        switch (op) {
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
            case 'upsert':
                if (method !== 'POST') {
                    return this.makeBadInputErrorResponse('invalid request method, only POST is supported');
                }
                if (!requestBody) {
                    return this.makeBadInputErrorResponse('missing request body');
                }

                args = requestBody;
                resCode = 201;
                break;

            case 'findFirst':
            case 'findUnique':
            case 'findMany':
            case 'aggregate':
            case 'groupBy':
            case 'count':
                if (method !== 'GET') {
                    return this.makeBadInputErrorResponse('invalid request method, only GET is supported');
                }
                args = qArgs ?? {};
                break;

            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
                if (method !== 'PUT' && method !== 'PATCH') {
                    return this.makeBadInputErrorResponse('invalid request method, only PUT or PATCH are supported');
                }
                if (!requestBody) {
                    return this.makeBadInputErrorResponse('missing request body');
                }

                args = requestBody;
                break;

            case 'delete':
            case 'deleteMany':
                if (method !== 'DELETE') {
                    return this.makeBadInputErrorResponse('invalid request method, only DELETE is supported');
                }
                args = qArgs ?? {};
                break;

            default:
                break;
        }

        if (!BUILT_IN_OPERATIONS.has(op)) {
            const custom = this.options.customOperations?.[op];
            if (custom) {
                try {
                    return await custom({
                        client,
                        method,
                        path,
                        query: normalizedQuery,
                        requestBody,
                        model,
                        operation: op,
                        args: qArgs,
                    });
                } catch (err) {
                    return this.mapCustomOperationError(err);
                }
            }

            return this.makeBadInputErrorResponse('invalid operation: ' + op);
        }

        const { result: processedArgs, error } = await this.processRequestPayload(args);
        if (error) {
            return this.makeBadInputErrorResponse(error);
        }

        try {
            if (!this.isValidModel(client, model)) {
                return this.makeBadInputErrorResponse(`unknown model name: ${model}`);
            }

            log(
                this.options.log,
                'debug',
                () => `handling "${model}.${op}" request with args: ${safeJSONStringify(processedArgs)}`,
            );

            const clientResult = await (client as any)[model][op](processedArgs);
            let responseBody: any = { data: clientResult };

            // superjson serialize response
            if (clientResult) {
                const { json, meta } = SuperJSON.serialize(clientResult);
                responseBody = { data: json };
                if (meta) {
                    responseBody.meta = { serialization: meta };
                }
            }

            const response = { status: resCode, body: responseBody };
            log(
                this.options.log,
                'debug',
                () => `sending response for "${model}.${op}" request: ${safeJSONStringify(response)}`,
            );
            return response;
        } catch (err) {
            log(this.options.log, 'error', `error occurred when handling "${model}.${op}" request`, err);
            if (err instanceof ORMError) {
                return this.makeORMErrorResponse(err);
            } else {
                return this.makeGenericErrorResponse(err);
            }
        }
    }

    private isValidModel(client: ClientContract<Schema>, model: string) {
        return Object.keys(client.$schema.models).some((m) => lowerCaseFirst(m) === lowerCaseFirst(model));
    }

    private makeBadInputErrorResponse(message: string) {
        const resp = {
            status: 400,
            body: { error: { message } },
        };
        log(this.options.log, 'debug', () => `sending error response: ${safeJSONStringify(resp)}`);
        return resp;
    }

    private makeGenericErrorResponse(err: unknown) {
        const resp = {
            status: 500,
            body: { error: { message: err instanceof Error ? err.message : 'unknown error' } },
        };
        log(
            this.options.log,
            'debug',
            () => `sending error response: ${safeJSONStringify(resp)}${err instanceof Error ? '\n' + err.stack : ''}`,
        );
        return resp;
    }

    private makeORMErrorResponse(err: ORMError) {
        let status = 400;
        const error: any = { message: err.message, reason: err.reason };

        match(err.reason)
            .with(ORMErrorReason.NOT_FOUND, () => {
                status = 404;
                error.model = err.model;
            })
            .with(ORMErrorReason.INVALID_INPUT, () => {
                status = 422;
                error.rejectedByValidation = true;
                error.model = err.model;
            })
            .with(ORMErrorReason.REJECTED_BY_POLICY, () => {
                status = 403;
                error.rejectedByPolicy = true;
                error.rejectReason = err.rejectedByPolicyReason;
                error.model = err.model;
            })
            .with(ORMErrorReason.DB_QUERY_ERROR, () => {
                status = 400;
                error.dbErrorCode = err.dbErrorCode;
            })
            .otherwise(() => {});

        const resp = { status, body: { error } };
        log(this.options.log, 'debug', () => `sending error response: ${safeJSONStringify(resp)}`);
        return resp;
    }

    private async processRequestPayload(args: any) {
        const { meta, ...rest } = args;
        if (meta?.serialization) {
            try {
                // superjson deserialization
                args = SuperJSON.deserialize({ json: rest, meta: meta.serialization });
            } catch (err) {
                return { result: undefined, error: `failed to deserialize request payload: ${(err as Error).message}` };
            }
        }
        return { result: args, error: undefined };
    }

    private unmarshalQ(value: string, meta: string | undefined) {
        let parsedValue: any;
        try {
            parsedValue = JSON.parse(value);
        } catch {
            throw new Error('invalid "q" query parameter');
        }

        if (meta) {
            let parsedMeta: any;
            try {
                parsedMeta = JSON.parse(meta);
            } catch {
                throw new Error('invalid "meta" query parameter');
            }

            if (parsedMeta.serialization) {
                return SuperJSON.deserialize({ json: parsedValue, meta: parsedMeta.serialization });
            }
        }

        return parsedValue;
    }

    private normalizeQuery(originalQuery: RequestContext<Schema>['query']) {
        if (!originalQuery) {
            return { query: originalQuery, qArgs: undefined as unknown };
        }

        const qValue = (originalQuery as any).q;
        if (typeof qValue === 'undefined') {
            return { query: originalQuery, qArgs: undefined as unknown };
        }

        if (typeof qValue !== 'string') {
            return { query: originalQuery, qArgs: undefined as unknown, error: 'invalid "q" query parameter' };
        }

        try {
            const parsed = this.unmarshalQ(qValue, (originalQuery as any).meta as string | undefined);
            return { query: { ...(originalQuery as any), q: parsed }, qArgs: parsed };
        } catch (err) {
            return {
                query: originalQuery,
                qArgs: undefined as unknown,
                error: err instanceof Error ? err.message : 'invalid "q" query parameter',
            };
        }
    }

    private mapCustomOperationError(err: unknown): Response {
        if (err instanceof RPCBadInputErrorResponse) {
            return this.makeBadInputErrorResponse(err.message);
        }

        if (err instanceof ORMError) {
            return this.makeORMErrorResponse(err);
        }

        if (err instanceof RPCGenericErrorResponse) {
            return this.makeGenericErrorResponse(err);
        }

        return this.makeGenericErrorResponse(err);
    }

    private validateCustomOperations() {
        const customOps = this.options.customOperations;
        if (!customOps) {
            return;
        }

        Object.entries(customOps).forEach(([name, fn]) => {
            if (!JS_IDENTIFIER_RE.test(name)) {
                throw new Error(`custom operation name must be a valid identifier: ${name}`);
            }

            if (BUILT_IN_OPERATIONS.has(name)) {
                throw new Error(`custom operation cannot override built-in operation: ${name}`);
            }

            if (typeof fn !== 'function') {
                throw new Error(`custom operation must be a function: ${name}`);
            }
        });
    }
}
