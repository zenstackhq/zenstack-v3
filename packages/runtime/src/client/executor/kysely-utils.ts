import { type OperationNode, AliasNode } from 'kysely';

/**
 * Strips alias from the node if it exists.
 */
export function stripAlias(node: OperationNode) {
    if (AliasNode.is(node)) {
        return { alias: node.alias, node: node.node };
    } else {
        return { alias: undefined, node };
    }
}
