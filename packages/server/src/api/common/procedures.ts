import { InputValidator, ORMError } from '@zenstackhq/orm';
import type { ClientContract } from '@zenstackhq/orm';
import type { ProcedureDef, SchemaDef } from '@zenstackhq/orm/schema';
import SuperJSON from 'superjson';

export const PROCEDURE_ROUTE_PREFIXES = ['$procs'] as const;

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
): unknown {
    const params = procDef.params ?? [];
    if (params.length === 0) {
        if (typeof payload === 'undefined') {
            return undefined;
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const envelope = payload as Record<string, unknown>;
            const argsPayload = Object.prototype.hasOwnProperty.call(envelope, 'args') ? (envelope as any).args : undefined;

            if (typeof argsPayload === 'undefined') {
                return payload;
            }

            if (argsPayload && typeof argsPayload === 'object' && !Array.isArray(argsPayload)) {
                if (Object.keys(argsPayload as any).length === 0) {
                    return payload;
                }
            }
        }
        throw new Error('procedure does not accept arguments');
    }

    // For procedures where every parameter is optional, allow omitting the payload entirely.
    if (typeof payload === 'undefined' && params.every((p) => p.optional)) {
        return undefined;
    }

    if (typeof payload === 'undefined') {
        throw new Error('missing procedure arguments');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('procedure payload must be an object');
    }

    const envelope = payload as Record<string, unknown>;
    const argsPayload = Object.prototype.hasOwnProperty.call(envelope, 'args') ? (envelope as any).args : undefined;

    if (typeof argsPayload === 'undefined') {
        if (params.every((p) => p.optional)) {
            return payload;
        }
        throw new Error('missing procedure arguments');
    }

    if (!argsPayload || typeof argsPayload !== 'object' || Array.isArray(argsPayload)) {
        throw new Error('procedure `args` must be an object');
    }

    const obj = argsPayload as Record<string, unknown>;

    // reject unknown keys to avoid silently ignoring user mistakes
    for (const key of Object.keys(obj)) {
        if (!params.some((p) => p.name === key)) {
            throw new Error(`unknown procedure argument: ${key}`);
        }
    }

    // ensure required params are present
    for (const p of params) {
        if (!Object.prototype.hasOwnProperty.call(obj, p.name)) {
            if (p.optional) {
                continue;
            }
            throw new Error(`missing procedure argument: ${p.name}`);
        }
    }

    return payload;
}

export function validateProcedureArgs<Schema extends SchemaDef>(
    client: ClientContract<Schema>,
    proc: string,
    input: unknown,
): unknown {
    // Respect the global input validation toggle.
    if (client.$options.validateInput === false) {
        return input;
    }

    const validator = new InputValidator(client as any);
    return validator.validateProcedureInput(proc, input);
}

export function isOrmError(err: unknown): err is ORMError {
    return err instanceof ORMError;
}
