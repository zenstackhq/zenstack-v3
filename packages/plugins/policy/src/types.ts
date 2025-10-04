import type { CRUD_EXT } from '@zenstackhq/runtime';
import type { Expression } from '@zenstackhq/runtime/schema';

/**
 * Access policy kind.
 */
export type PolicyKind = 'allow' | 'deny';

/**
 * Access policy operation.
 */
export type PolicyOperation = CRUD_EXT | 'all';

/**
 * Access policy definition.
 */
export type Policy = {
    kind: PolicyKind;
    operations: readonly PolicyOperation[];
    condition: Expression;
};
