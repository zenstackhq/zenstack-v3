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
    private currentModel: string | undefined;

    constructor(private readonly schema: SchemaDef) {
        super();
        for (const [modelName, modelDef] of Object.entries(schema.models)) {
            const mappedName = this.getMappedName(modelDef);
            if (mappedName) {
                this.modelToTableMap.set(modelName, mappedName);
            }

            for (const [fieldName, fieldDef] of Object.entries(
                modelDef.fields
            )) {
                const mappedName = this.getMappedName(fieldDef);
                if (mappedName) {
                    this.fieldToColumnMap.set(
                        `${modelName}.${fieldName}`,
                        mappedName
                    );
                }
            }
        }
    }

    protected override transformCreateTable(node: CreateTableNode) {
        this.currentModel = node.table.table.identifier.name;
        return super.transformCreateTable(node);
    }

    protected override transformInsertQuery(node: InsertQueryNode) {
        this.currentModel = node.into?.table.identifier.name;
        return super.transformInsertQuery(node);
    }

    protected override transformReturning(node: ReturningNode) {
        return ReturningNode.create(
            this.transformSelections(node.selections, node)
        );
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        this.currentModel = undefined;
        if (node.table && TableNode.is(node.table)) {
            this.currentModel = node.table.table.identifier.name;
        }
        return super.transformUpdateQuery(node);
    }

    protected override transformDeleteQuery(
        node: DeleteQueryNode
    ): DeleteQueryNode {
        this.currentModel = undefined;
        if (
            node.from?.froms &&
            node.from.froms.length === 1 &&
            node.from.froms[0]
        ) {
            const from = node.from.froms[0];
            if (TableNode.is(from)) {
                this.currentModel = from.table.identifier.name;
            } else if (AliasNode.is(from) && TableNode.is(from.node)) {
                this.currentModel = from.node.table.identifier.name;
            }
        }
        return super.transformDeleteQuery(node);
    }

    protected override transformSelectQuery(node: SelectQueryNode) {
        this.currentModel = undefined;
        if (
            node.from?.froms &&
            node.from.froms.length === 1 &&
            node.from.froms[0]
        ) {
            const from = node.from.froms[0];
            if (TableNode.is(from)) {
                this.currentModel = from.table.identifier.name;
            } else if (AliasNode.is(from) && TableNode.is(from.node)) {
                this.currentModel = from.node.table.identifier.name;
            }
        } else {
            throw new InternalError(
                `SelectQueryNode must have a single table in from clause`
            );
        }

        const selections = node.selections
            ? this.transformSelections(node.selections, node)
            : node.selections;

        return {
            ...super.transformSelectQuery(node),
            selections,
        };
    }

    private transformSelections(
        selections: readonly SelectionNode[],
        contextNode: OperationNode
    ) {
        const hasSelectAll = selections.some((s) =>
            SelectAllNode.is(s.selection)
        );
        if (!hasSelectAll && !this.modelHasFieldsWithMappedNames(contextNode)) {
            return selections;
        }

        const result = selections
            .filter((s) => !SelectAllNode.is(s.selection))
            .map((s) => this.transformSelectionWithAlias(s));
        const scalarFields = this.getModelScalarFields(contextNode);
        return [
            ...result,
            ...scalarFields.map((fieldName) =>
                SelectionNode.create(
                    this.fieldHasMappedName(fieldName, contextNode)
                        ? AliasNode.create(
                              ColumnNode.create(
                                  this.mapFieldName(fieldName, contextNode)
                              ),
                              IdentifierNode.create(fieldName)
                          )
                        : ColumnNode.create(
                              this.mapFieldName(fieldName, contextNode)
                          )
                )
            ),
        ];
    }

    private modelHasFieldsWithMappedNames(_contextNode: OperationNode) {
        // this.requireCurrentModel(contextNode);
        if (!this.currentModel) {
            return false;
        }
        const modelDef = requireModel(this.schema, this.currentModel!);
        return Object.keys(modelDef.fields).some((name) =>
            this.fieldToColumnMap.has(`${this.currentModel}.${name}`)
        );
    }

    private transformSelectionWithAlias(node: SelectionNode) {
        if (
            ColumnNode.is(node.selection) &&
            this.fieldHasMappedName(node.selection.column.name, node)
        ) {
            return SelectionNode.create(
                AliasNode.create(
                    this.transformColumn(node.selection),
                    IdentifierNode.create(node.selection.column.name)
                )
            );
        } else if (
            ReferenceNode.is(node.selection) &&
            this.fieldHasMappedName(
                (node.selection.column as ColumnNode).column.name,
                node
            )
        ) {
            return SelectionNode.create(
                AliasNode.create(
                    this.transformReference(node.selection),
                    IdentifierNode.create(
                        (node.selection.column as ColumnNode).column.name
                    )
                )
            );
        } else {
            return this.transformSelection(node);
        }
    }

    private fieldHasMappedName(name: string, contextNode: OperationNode) {
        this.requireCurrentModel(contextNode);
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
        return ColumnNode.create(this.mapFieldName(node.column.name, node));
    }

    private getMappedName(def: ModelDef | FieldDef) {
        const mapAttr = def.attributes?.find(
            (attr) => attr.name === '@@map' || attr.name === '@map'
        );
        if (mapAttr) {
            const nameArg = mapAttr.args?.find((arg) => arg.name === 'name');
            if (nameArg && nameArg.value.kind === 'literal') {
                return nameArg.value.value as string;
            }
        }
        return undefined;
    }

    private mapFieldName(
        fieldName: string,
        contextNode: OperationNode
    ): string {
        this.requireCurrentModel(contextNode);
        const mappedName = this.fieldToColumnMap.get(
            `${this.currentModel}.${fieldName}`
        );
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

    private getModelScalarFields(contextNode: OperationNode) {
        this.requireCurrentModel(contextNode);
        const modelDef = requireModel(this.schema, this.currentModel!);
        const scalarFields = Object.entries(modelDef.fields)
            .filter(([, fieldDef]) => !fieldDef.relation && !fieldDef.computed)
            .map(([fieldName]) => fieldName);
        return scalarFields;
    }
}
