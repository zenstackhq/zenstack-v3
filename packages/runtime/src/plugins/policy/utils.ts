import type { OperationNode } from 'kysely';
import {
    AliasNode,
    AndNode,
    BinaryOperationNode,
    FunctionNode,
    OperatorNode,
    OrNode,
    ParensNode,
    ReferenceNode,
    TableNode,
    UnaryOperationNode,
    ValueNode,
} from 'kysely';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import type { SchemaDef } from '../../schema';

/**
 * Creates a `true` value node.
 */
export function trueNode<Schema extends SchemaDef>(
    dialect: BaseCrudDialect<Schema>
) {
    return ValueNode.createImmediate(
        dialect.transformPrimitive(true, 'Boolean')
    );
}

/**
 * Creates a `false` value node.
 */
export function falseNode<Schema extends SchemaDef>(
    dialect: BaseCrudDialect<Schema>
) {
    return ValueNode.createImmediate(
        dialect.transformPrimitive(false, 'Boolean')
    );
}

/**
 * Checks if a node is a truthy value node.
 */
export function isTrueNode(node: OperationNode): boolean {
    return ValueNode.is(node) && (node.value === true || node.value === 1);
}

/**
 * Checks if a node is a falsy value node.
 */
export function isFalseNode(node: OperationNode): boolean {
    return ValueNode.is(node) && (node.value === false || node.value === 0);
}

/**
 * Builds a logical conjunction of a list of nodes.
 */
export function conjunction<Schema extends SchemaDef>(
    dialect: BaseCrudDialect<Schema>,
    nodes: OperationNode[]
): OperationNode {
    if (nodes.some(isFalseNode)) {
        return falseNode(dialect);
    }
    const items = nodes.filter((n) => !isTrueNode(n));
    if (items.length === 0) {
        return trueNode(dialect);
    }
    return items.reduce((acc, node) =>
        OrNode.is(node)
            ? AndNode.create(acc, ParensNode.create(node)) // wraps parentheses
            : AndNode.create(acc, node)
    );
}

export function disjunction<Schema extends SchemaDef>(
    dialect: BaseCrudDialect<Schema>,
    nodes: OperationNode[]
): OperationNode {
    if (nodes.some(isTrueNode)) {
        return trueNode(dialect);
    }
    const items = nodes.filter((n) => !isFalseNode(n));
    if (items.length === 0) {
        return falseNode(dialect);
    }
    return items.reduce((acc, node) =>
        AndNode.is(node)
            ? OrNode.create(acc, ParensNode.create(node)) // wraps parentheses
            : OrNode.create(acc, node)
    );
}

/**
 * Negates a logical expression.
 */
export function logicalNot(node: OperationNode): OperationNode {
    return UnaryOperationNode.create(
        OperatorNode.create('not'),
        AndNode.is(node) || OrNode.is(node)
            ? ParensNode.create(node) // wraps parentheses
            : node
    );
}

/**
 * Builds an expression node that checks if a node is true.
 */
export function buildIsTrue<Schema extends SchemaDef>(
    node: OperationNode,
    dialect: BaseCrudDialect<Schema>
) {
    if (isTrueNode(node)) {
        return trueNode(dialect);
    } else if (isFalseNode(node)) {
        return falseNode(dialect);
    }
    return BinaryOperationNode.create(
        node,
        OperatorNode.create('='),
        trueNode(dialect)
    );
}

/**
 * Builds an expression node that checks if a node is false.
 */
export function buildIsFalse<Schema extends SchemaDef>(
    node: OperationNode,
    dialect: BaseCrudDialect<Schema>
) {
    if (isFalseNode(node)) {
        return trueNode(dialect);
    } else if (isTrueNode(node)) {
        return falseNode(dialect);
    }
    return BinaryOperationNode.create(
        // coalesce so null is treated as false
        FunctionNode.create('coalesce', [node, falseNode(dialect)]),
        OperatorNode.create('='),
        falseNode(dialect)
    );
}

/**
 * Gets the table name from a node.
 */
export function getTableName(node: OperationNode | undefined) {
    if (!node) {
        return node;
    }
    if (TableNode.is(node)) {
        return node.table.identifier.name;
    } else if (AliasNode.is(node)) {
        return getTableName(node.node);
    } else if (ReferenceNode.is(node) && node.table) {
        return getTableName(node.table);
    }
    return undefined;
}
