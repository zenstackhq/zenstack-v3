import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { Decimal } from 'decimal.js';
import SuperJSON from 'superjson';
import { describe, expect, it, vi } from 'vitest';
import { log, registerCustomSerializers } from '../../src/api/utils';
import { type ApiHandler, type LogConfig, type RequestContext, type Response } from '../../src/types';

class CustomApiHandler implements ApiHandler<SchemaDef> {
    protected readonly handled: Array<RequestContext<SchemaDef>> = [];

    constructor(protected readonly schemaDef: SchemaDef, protected readonly logger: LogConfig) {}

    get schema(): SchemaDef {
        return this.schemaDef;
    }

    get log(): LogConfig {
        return this.logger;
    }

    get contexts(): ReadonlyArray<RequestContext<SchemaDef>> {
        return this.handled;
    }

    async handleRequest(context: RequestContext<SchemaDef>): Promise<Response> {
        this.handled.push(context);
        log(this.logger, 'info', () => `received ${context.method.toUpperCase()} ${context.path}`);
        return { status: 202, body: { handled: true } };
    }
}

describe('Custom API handler test', () => {
    const schema = {} as SchemaDef;
    const client = { $schema: schema } as unknown as ClientContract<SchemaDef>;

    it('allows building custom handlers with logging helpers', async () => {
        const logger = vi.fn();
        const handler = new CustomApiHandler(schema, logger);

        const response = await handler.handleRequest({
            method: 'post',
            path: '/custom',
            query: { foo: 'bar' },
            requestBody: { value: 1 },
            client,
        });

        expect(response).toEqual({ status: 202, body: { handled: true } });
        expect(handler.contexts).toHaveLength(1);
        expect(handler.contexts[0].query).toEqual({ foo: 'bar' });
        expect(logger).toHaveBeenCalledWith('info', 'received POST /custom', undefined);
    });

    it('provides serialization helpers for custom handlers', () => {
        registerCustomSerializers();
        const serialized = SuperJSON.serialize({ value: new Decimal('3.14159') });
        const roundTripped = SuperJSON.deserialize(serialized) as { value: Decimal };
        expect(Decimal.isDecimal(roundTripped.value)).toBe(true);
        expect(roundTripped.value.toString()).toBe('3.14159');
    });
});
