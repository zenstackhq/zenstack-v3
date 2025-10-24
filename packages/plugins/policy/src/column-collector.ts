import { KyselyUtils } from '@zenstackhq/orm';
import type { ColumnNode, OperationNode } from 'kysely';

/**
 * Collects all column names from a query.
 */
export class ColumnCollector extends KyselyUtils.DefaultOperationNodeVisitor {
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
