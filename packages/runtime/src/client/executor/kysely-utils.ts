import { invariant } from '@zenstackhq/common-helpers';
import { type OperationNode, AliasNode, IdentifierNode } from 'kysely';

/**
 * Strips alias from the node if it exists.
 */
export function stripAlias(node: OperationNode) {
    if (AliasNode.is(node)) {
        invariant(IdentifierNode.is(node.alias), 'Expected identifier as alias');
        return { alias: node.alias.name, node: node.node };
    } else {
        return { alias: undefined, node };
    }
}
