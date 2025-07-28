import {
    AliasNode,
    ColumnNode,
    CreateTableNode,
    DeleteQueryNode,
    IdentifierNode,
    InsertQueryNode,
    OperationNodeTransformer,
    ReferenceNode,
    ReturningNode,
    SelectAllNode,
    SelectionNode,
    SelectQueryNode,
    TableNode,
    UpdateQueryNode,
    type OperationNode,
} from 'kysely';
import type { FieldDef, ModelDef, SchemaDef } from '../../schema';
import { InternalError } from '../errors';
import { requireModel } from '../query-utils';

export class QueryNameMapper extends OperationNodeTransformer {
    private readonly modelToTableMap = new Map<string, string>();
    private readonly fieldToColumnMap = new Map<string, string>();
    private readonly modelStack: string[] = [];

    constructor(private readonly schema: SchemaDef) {
        super();
        for (const [modelName, modelDef] of Object.entries(schema.models)) {
            const mappedName = this.getMappedName(modelDef);
            if (mappedName) {
                this.modelToTableMap.set(modelName, mappedName);
            }

            for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
                const mappedName = this.getMappedName(fieldDef);
                if (mappedName) {
                    this.fieldToColumnMap.set(`${modelName}.${fieldName}`, mappedName);
                }
            }
        }
    }

    private get currentModel() {
        return this.modelStack[this.modelStack.length - 1];
    }

    protected override transformCreateTable(node: CreateTableNode) {
        try {
            this.modelStack.push(node.table.table.identifier.name);
            return super.transformCreateTable(node);
        } finally {
            this.modelStack.pop();
        }
    }

    protected override transformInsertQuery(node: InsertQueryNode) {
        try {
            if (node.into?.table.identifier.name) {
                this.modelStack.push(node.into.table.identifier.name);
            }
            return super.transformInsertQuery(node);
        } finally {
            if (node.into?.table.identifier.name) {
                this.modelStack.pop();
            }
        }
    }

    protected override transformReturning(node: ReturningNode) {
        return ReturningNode.create(this.transformSelections(node.selections, node));
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        let pushed = false;
        if (node.table && TableNode.is(node.table)) {
            this.modelStack.push(node.table.table.identifier.name);
            pushed = true;
        }
        try {
            return super.transformUpdateQuery(node);
        } finally {
            if (pushed) {
                this.modelStack.pop();
            }
        }
    }

    protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
        let pushed = false;
        if (node.from?.froms && node.from.froms.length === 1 && node.from.froms[0]) {
            const from = node.from.froms[0];
            if (TableNode.is(from)) {
                this.modelStack.push(from.table.identifier.name);
                pushed = true;
            } else if (AliasNode.is(from) && TableNode.is(from.node)) {
                this.modelStack.push(from.node.table.identifier.name);
                pushed = true;
            }
        }
        try {
            return super.transformDeleteQuery(node);
        } finally {
            if (pushed) {
                this.modelStack.pop();
            }
        }
    }

    protected override transformSelectQuery(node: SelectQueryNode) {
        if (!node.from?.froms || node.from.froms.length === 0) {
            return super.transformSelectQuery(node);
        }

        if (node.from.froms.length > 1) {
            throw new InternalError(`SelectQueryNode must have a single table in from clause`);
        }

        let pushed = false;
        const from = node.from.froms[0]!;
        if (TableNode.is(from)) {
            this.modelStack.push(from.table.identifier.name);
            pushed = true;
        } else if (AliasNode.is(from) && TableNode.is(from.node)) {
            this.modelStack.push(from.node.table.identifier.name);
            pushed = true;
        }

        const selections = node.selections ? this.transformSelections(node.selections, node) : node.selections;

        try {
            return {
                ...super.transformSelectQuery(node),
                selections,
            };
        } finally {
            if (pushed) {
                this.modelStack.pop();
            }
        }
    }

    private transformSelections(selections: readonly SelectionNode[], contextNode: OperationNode) {
        const result: SelectionNode[] = [];

        for (const selection of selections) {
            let selectAllFromModel: string | undefined = undefined;
            let isSelectAll = false;

            if (SelectAllNode.is(selection.selection)) {
                selectAllFromModel = this.currentModel;
                isSelectAll = true;
            } else if (ReferenceNode.is(selection.selection) && SelectAllNode.is(selection.selection.column)) {
                selectAllFromModel = selection.selection.table?.table.identifier.name ?? this.currentModel;
                isSelectAll = true;
            }

            if (isSelectAll) {
                if (!selectAllFromModel) {
                    continue;
                } else {
                    const scalarFields = this.getModelScalarFields(contextNode, selectAllFromModel);
                    const fromModelDef = requireModel(this.schema, selectAllFromModel);
                    const mappedTableName = this.getMappedName(fromModelDef) ?? selectAllFromModel;
                    result.push(
                        ...scalarFields.map((fieldName) => {
                            const fieldRef = ReferenceNode.create(
                                ColumnNode.create(this.mapFieldName(fieldName)),
                                TableNode.create(mappedTableName),
                            );
                            return SelectionNode.create(
                                this.fieldHasMappedName(fieldName)
                                    ? AliasNode.create(fieldRef, IdentifierNode.create(fieldName))
                                    : fieldRef,
                            );
                        }),
                    );
                }
            } else {
                result.push(this.transformSelectionWithAlias(selection));
            }
        }

        return result;
    }

    private transformSelectionWithAlias(node: SelectionNode) {
        if (ColumnNode.is(node.selection) && this.fieldHasMappedName(node.selection.column.name)) {
            return SelectionNode.create(
                AliasNode.create(
                    this.transformColumn(node.selection),
                    IdentifierNode.create(node.selection.column.name),
                ),
            );
        } else if (
            ReferenceNode.is(node.selection) &&
            this.fieldHasMappedName((node.selection.column as ColumnNode).column.name)
        ) {
            return SelectionNode.create(
                AliasNode.create(
                    this.transformReference(node.selection),
                    IdentifierNode.create((node.selection.column as ColumnNode).column.name),
                ),
            );
        } else {
            return this.transformSelection(node);
        }
    }

    private fieldHasMappedName(name: string) {
        if (!this.currentModel) {
            return false;
        }
        return this.fieldToColumnMap.has(`${this.currentModel}.${name}`);
    }

    protected override transformTable(node: TableNode) {
        const tableName = node.table.identifier.name;
        const mappedName = this.modelToTableMap.get(tableName);
        if (mappedName) {
            // TODO: db schema?
            return TableNode.create(mappedName);
        } else {
            return node;
        }
    }

    protected override transformColumn(node: ColumnNode) {
        return ColumnNode.create(this.mapFieldName(node.column.name));
    }

    private getMappedName(def: ModelDef | FieldDef) {
        const mapAttr = def.attributes?.find((attr) => attr.name === '@@map' || attr.name === '@map');
        if (mapAttr) {
            const nameArg = mapAttr.args?.find((arg) => arg.name === 'name');
            if (nameArg && nameArg.value.kind === 'literal') {
                return nameArg.value.value as string;
            }
        }
        return undefined;
    }

    private mapFieldName(fieldName: string): string {
        if (!this.currentModel) {
            return fieldName;
        }
        const mappedName = this.fieldToColumnMap.get(`${this.currentModel}.${fieldName}`);
        if (mappedName) {
            return mappedName;
        } else {
            return fieldName;
        }
    }

    private requireCurrentModel(node: OperationNode) {
        if (!this.currentModel) {
            throw new InternalError(`Missing model context for "${node}"`);
        }
    }

    private getModelScalarFields(contextNode: OperationNode, model: string | undefined) {
        this.requireCurrentModel(contextNode);
        model = model ?? this.currentModel;
        const modelDef = requireModel(this.schema, model!);
        const scalarFields = Object.entries(modelDef.fields)
            .filter(([, fieldDef]) => !fieldDef.relation && !fieldDef.computed && !fieldDef.originModel)
            .map(([fieldName]) => fieldName);
        return scalarFields;
    }
}
