import { ORMError } from '@zenstackhq/orm';
import type { ProcedureDef, ProcedureParam, SchemaDef } from '@zenstackhq/orm/schema';

export const PROCEDURE_ROUTE_PREFIXES = '$procs' as const;

export function getProcedureDef(schema: SchemaDef, proc: string): ProcedureDef | undefined {
    const procs = schema.procedures ?? {};
    if (!Object.prototype.hasOwnProperty.call(procs, proc)) {
        return undefined;
    }
    return procs[proc];
}

/**
 * Maps and validates the incoming procedure payload for server-side routing.
 *
 * Supported payload formats:
 * - **Envelope (preferred)**: `{ args: { ... } }`
 * - **Direct object**: `{ ... }` (allowed only when *every* parameter is optional)
 *
 * The function returns the original `payload` unchanged; it only enforces payload
 * *shape* and argument presence/keys so downstream code can safely assume a
 * consistent contract.
 *
 * Validation / branching behavior (mirrors the code below):
 * - **Zero-parameter procedures** (`params.length === 0`)
 *   - `undefined` payload is accepted.
 *   - Object payloads without an `args` key are treated as “no args” and accepted.
 *   - Envelope payloads with `args: {}` are accepted.
 *   - Any other payload (including `args` with keys) is rejected.
 * - **All-optional parameter procedures**
 *   - Payload may be omitted (`undefined`).
 *   - If payload is an object and has no `args` key, it is treated as the direct
 *     object form.
 * - **Missing payload** (required parameters exist)
 *   - `undefined` is rejected.
 * - **Non-object or array payload**
 *   - Rejected.
 * - **Undefined/invalid `args` (envelope form)**
 *   - If `args` is missing and not all params are optional: rejected.
 *   - If `args` exists but is not a non-array object: rejected.
 * - **Unknown keys**
 *   - Any key in the `args` object that is not declared by the procedure is
 *     rejected (prevents silently ignoring typos).
 * - **Missing required params**
 *   - Any declared non-optional param missing from `args` is rejected.
 *
 * Rationale for rejecting null/falsey payloads:
 * - The checks `!payload` and `!argsPayload` intentionally reject values like
 *   `null`, `false`, `0`, or `''` instead of treating them as “no args”. This
 *   keeps the API strictly object-based and yields deterministic, descriptive
 *   errors rather than surprising coercion.
 *
 * @throws {Error} "procedure does not accept arguments"
 * @throws {Error} "missing procedure arguments"
 * @throws {Error} "procedure payload must be an object"
 * @throws {Error} "procedure `args` must be an object"
 * @throws {Error} "unknown procedure argument: <key>"
 * @throws {Error} "missing procedure argument: <name>"
 */
export function mapProcedureArgs(procDef: { params: Record<string, ProcedureParam> }, payload: unknown): unknown {
    const params = Object.values(procDef.params ?? {});
    if (params.length === 0) {
        if (typeof payload === 'undefined') {
            return undefined;
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const envelope = payload as Record<string, unknown>;
            const argsPayload = Object.prototype.hasOwnProperty.call(envelope, 'args')
                ? (envelope as any).args
                : undefined;

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

export function isOrmError(err: unknown): err is ORMError {
    return err instanceof ORMError;
}
