import { InputValidator, ORMError } from '@zenstackhq/orm';
import type { ClientContract } from '@zenstackhq/orm';
import type { ProcedureDef, SchemaDef } from '@zenstackhq/orm/schema';
import SuperJSON from 'superjson';

export const PROCEDURE_ROUTE_PREFIXES = ['$procedures', '$procs'] as const;

export function getProcedureDef(schema: SchemaDef, proc: string): ProcedureDef | undefined {
    const procs = schema.procedures ?? {};
    if (!Object.prototype.hasOwnProperty.call(procs, proc)) {
        return undefined;
    }
    return procs[proc];
}

export function unmarshalQ(value: string, meta: string | undefined) {
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

/**
 * Supports the SuperJSON request payload format used by other RPC-style endpoints:
 * `{ meta: { serialization }, ...json }`.
 */
export async function processSuperJsonRequestPayload(payload: unknown) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('meta' in (payload as any))) {
        return { result: payload, error: undefined as string | undefined };
    }

    const { meta, ...rest } = payload as any;
    if (meta?.serialization) {
        try {
            return {
                result: SuperJSON.deserialize({ json: rest, meta: meta.serialization }),
                error: undefined as string | undefined,
            };
        } catch (err) {
            return {
                result: undefined,
                error: `failed to deserialize request payload: ${(err as Error).message}`,
            };
        }
    }

    // drop meta when no serialization info is present
    return { result: rest, error: undefined as string | undefined };
}

export function mapProcedureArgs(
    procDef: { params: ReadonlyArray<{ name: string; optional?: boolean; array?: boolean }> },
    payload: unknown,
): unknown[] {
    const params = procDef.params ?? [];
    if (params.length === 0) {
        if (typeof payload === 'undefined') {
            return [];
        }
        if (Array.isArray(payload) && payload.length === 0) {
            return [];
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload as any).length === 0) {
            return [];
        }
        throw new Error('procedure does not accept arguments');
    }

    // For procedures where every parameter is optional, allow omitting the payload entirely.
    if (typeof payload === 'undefined' && params.every((p) => p.optional)) {
        return params.map(() => undefined);
    }

    if (Array.isArray(payload)) {
        // For a single array-typed parameter, allow sending `q` as a JSON array
        // (otherwise it is ambiguous with positional args).
        if (params.length === 1 && params[0]?.array) {
            return [payload];
        }

        if (payload.length > params.length) {
            throw new Error(`too many procedure arguments: expected at most ${params.length}`);
        }

        return params.map((p, idx) => {
            if (idx >= payload.length) {
                if (p.optional) {
                    return undefined;
                }
                throw new Error(`missing procedure argument: ${p.name}`);
            }
            return payload[idx];
        });
    }

    if (params.length === 1) {
        const param = params[0]!;
        if (typeof payload === 'undefined') {
            if (param.optional) {
                return [undefined];
            }
            throw new Error(`missing procedure argument: ${param.name}`);
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const obj = payload as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(obj, param.name) && Object.keys(obj).length === 1) {
                return [obj[param.name]];
            }
        }
        return [payload];
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('procedure arguments must be an object or array');
    }

    const obj = payload as Record<string, unknown>;

    // reject unknown keys to avoid silently ignoring user mistakes
    for (const key of Object.keys(obj)) {
        if (!params.some((p) => p.name === key)) {
            throw new Error(`unknown procedure argument: ${key}`);
        }
    }

    return params.map((p) => {
        if (!Object.prototype.hasOwnProperty.call(obj, p.name)) {
            if (p.optional) {
                return undefined;
            }
            throw new Error(`missing procedure argument: ${p.name}`);
        }
        return obj[p.name];
    });
}

export function validateProcedureArgs<Schema extends SchemaDef>(
    client: ClientContract<Schema>,
    proc: string,
    args: unknown[],
): unknown[] {
    // Respect the global input validation toggle.
    if (client.$options.validateInput === false) {
        return args;
    }

    const validator = new InputValidator(client as any);
    return validator.validateProcedureArgs(proc, args);
}

export function isOrmError(err: unknown): err is ORMError {
    return err instanceof ORMError;
}
