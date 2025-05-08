import type { ColumnNode, OperationNode } from 'kysely';
import { DefaultOperationNodeVisitor } from '../../utils/default-operation-node-visitor';

/**
 * Collects all column names from a query.
 */
export class ColumnCollector extends DefaultOperationNodeVisitor {
    private columns: string[] = [];

    collect(node: OperationNode) {
        this.columns = [];
        this.visitNode(node);
        return this.columns;
    }

    protected override visitColumn(node: ColumnNode): void {
        if (!this.columns.includes(node.column.name)) {
            this.columns.push(node.column.name);
        }
    }
}
