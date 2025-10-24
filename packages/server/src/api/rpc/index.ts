import { lowerCaseFirst, safeJSONStringify } from '@zenstackhq/common-helpers';
import {
    InputValidationError,
    NotFoundError,
    RejectedByPolicyError,
    ZenStackError,
    type ClientContract,
} from '@zenstackhq/runtime';
import type { SchemaDef } from '@zenstackhq/runtime/schema';
import SuperJSON from 'superjson';
import type { ApiHandler, LogConfig, RequestContext, Response } from '../../types';
import { log, registerCustomSerializers } from '../utils';

registerCustomSerializers();

/**
 * Options for {@link RPCApiHandler}
 */
export type RPCApiHandlerOptions<Schema extends SchemaDef> = {
    schema: Schema;
    log?: LogConfig;
};

/**
 * RPC style API request handler that mirrors the ZenStackClient API
 */
export class RPCApiHandler<Schema extends SchemaDef> implements ApiHandler<Schema> {
    constructor(private readonly options: RPCApiHandlerOptions<Schema>) {}

    get schema(): Schema {
        return this.options.schema;
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
                try {
                    args = query?.['q']
                        ? this.unmarshalQ(query['q'] as string, query['meta'] as string | undefined)
                        : {};
                } catch {
                    return this.makeBadInputErrorResponse('invalid "q" query parameter');
                }
                break;

            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
                if (method !== 'PUT' && method !== 'PATCH') {
                    return this.makeBadInputErrorResponse('invalid request method, only PUT AND PATCH are supported');
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
                try {
                    args = query?.['q']
                        ? this.unmarshalQ(query['q'] as string, query['meta'] as string | undefined)
                        : {};
                } catch (err) {
                    return this.makeBadInputErrorResponse(
                        err instanceof Error ? err.message : 'invalid "q" query parameter',
                    );
                }
                break;

            default:
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
            if (err instanceof ZenStackError) {
                return this.makeZenStackErrorResponse(err);
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
            body: { error: { message: (err as Error).message || 'unknown error' } },
        };
        log(this.options.log, 'debug', () => `sending error response: ${safeJSONStringify(resp)}`);
        return resp;
    }

    private makeZenStackErrorResponse(err: ZenStackError) {
        let status = 400;
        const error: any = { message: err.message };
        if (err.cause && err.cause instanceof Error) {
            error.cause = err.cause.message;
        }

        if (err instanceof NotFoundError) {
            status = 404;
            error.model = err.model;
        } else if (err instanceof InputValidationError) {
            status = 422;
            error.rejectedByValidation = true;
            error.model = err.model;
        } else if (err instanceof RejectedByPolicyError) {
            status = 403;
            error.rejectedByPolicy = true;
            error.rejectReason = err.reason;
            error.model = err.model;
        }

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
}
