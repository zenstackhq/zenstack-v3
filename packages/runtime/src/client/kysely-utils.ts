import { type OperationNode, AliasNode, ColumnNode, ReferenceNode, TableNode } from 'kysely';

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

/**
 * Extracts model name from an OperationNode.
 */
export function extractModelName(node: OperationNode) {
    const { node: innerNode } = stripAlias(node);
    return TableNode.is(innerNode!) ? innerNode!.table.identifier.name : undefined;
}

/**
 * Extracts field name from an OperationNode.
 */
export function extractFieldName(node: OperationNode) {
    if (ReferenceNode.is(node) && ColumnNode.is(node.column)) {
        return node.column.column.name;
    } else if (ColumnNode.is(node)) {
        return node.column.name;
    } else {
        return undefined;
    }
}
