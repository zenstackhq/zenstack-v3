import type { CRUD } from '../../client/contract';
import type { Expression } from '../../schema';

/**
 * Access policy kind.
 */
export type PolicyKind = 'allow' | 'deny';

/**
 * Access policy operation.
 */
export type PolicyOperation = CRUD | 'all';

/**
 * Access policy definition.
 */
export type Policy = {
    kind: PolicyKind;
    operations: readonly PolicyOperation[];
    condition: Expression;
};
