import { invariant } from '@zenstackhq/common-helpers';
import {
    AliasNode,
    ColumnNode,
    DeleteQueryNode,
    FromNode,
    IdentifierNode,
    InsertQueryNode,
    JoinNode,
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
import { getModel, requireModel } from '../query-utils';

type Scope = {
    model: string;
    alias?: string;
    namesMapped?: boolean;
};

export class QueryNameMapper extends OperationNodeTransformer {
    private readonly modelToTableMap = new Map<string, string>();
    private readonly fieldToColumnMap = new Map<string, string>();
    private readonly modelScopes: Scope[] = [];

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

    // #region overrides

    protected override transformSelectQuery(node: SelectQueryNode) {
        if (!node.from?.froms) {
            return super.transformSelectQuery(node);
        }

        // all table names in "from" are pushed as scopes, each "from" is expanded
        // as nested query to apply column name mapping, so the scopes are marked
        // "namesMapped" so no additional name mapping is applied when resolving
        // columns
        const scopes = this.createScopesFromFroms(node.from, true);
        return this.withScopes(scopes, () => {
            return {
                ...super.transformSelectQuery(node),
                // convert "from" to nested query as needed
                from: this.processFrom(node.from!),
            };
        });
    }

    protected override transformInsertQuery(node: InsertQueryNode) {
        if (!node.into) {
            return super.transformInsertQuery(node);
        }

        return this.withScope(
            { model: node.into.table.identifier.name },
            () =>
                ({
                    ...super.transformInsertQuery(node),
                    // map table name
                    into: this.processTableRef(node.into!),
                }) satisfies InsertQueryNode,
        );
    }

    protected override transformReturning(node: ReturningNode) {
        return {
            kind: node.kind,
            // map column names in returning selections (include returningAll)
            selections: this.processSelections(node.selections),
        };
    }

    protected override transformJoin(node: JoinNode) {
        const { alias, node: innerNode } = this.stripAlias(node.table);
        if (TableNode.is(innerNode!)) {
            const modelName = innerNode.table.identifier.name;
            if (this.hasMappedColumns(modelName)) {
                // create a nested query with all fields selected and names mapped
                const select = this.createSelectAll(modelName);
                return { ...super.transformJoin(node), table: this.wrapAlias(select, alias ?? modelName) };
            }
        }
        return super.transformJoin(node);
    }

    protected override transformReference(node: ReferenceNode) {
        if (!ColumnNode.is(node.column)) {
            return super.transformReference(node);
        }

        // resolve the reference to a field from outer scopes
        const { fieldDef, modelDef, scope } = this.resolveFieldFromScopes(
            node.column.column.name,
            node.table?.table.identifier.name,
        );
        if (fieldDef && !scope.namesMapped) {
            // map column name and table name as needed
            const mappedFieldName = this.mapFieldName(modelDef.name, fieldDef.name);

            // map table name depending on how it is resolved
            let mappedTableName = node.table?.table.identifier.name;
            if (mappedTableName) {
                if (scope.alias === mappedTableName) {
                    // table name is resolved to an alias, no mapping needed
                } else if (scope.model === mappedTableName) {
                    // table name is resolved to a model, map the name as needed
                    mappedTableName = this.mapTableName(scope.model);
                }
            }

            return ReferenceNode.create(
                ColumnNode.create(mappedFieldName),
                mappedTableName ? TableNode.create(mappedTableName) : undefined,
            );
        } else {
            return super.transformReference(node);
        }
    }

    protected override transformColumn(node: ColumnNode) {
        const { modelDef, fieldDef, scope } = this.resolveFieldFromScopes(node.column.name);
        if (!fieldDef || scope.namesMapped) {
            return super.transformColumn(node);
        }
        const mappedName = this.mapFieldName(modelDef.name, fieldDef.name);
        return ColumnNode.create(mappedName);
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        const { alias, node: innerTable } = this.stripAlias(node.table);
        if (!innerTable || !TableNode.is(innerTable)) {
            return super.transformUpdateQuery(node);
        }

        return this.withScope({ model: innerTable.table.identifier.name, alias }, () => {
            return {
                ...super.transformUpdateQuery(node),
                // map table name
                table: this.wrapAlias(this.processTableRef(innerTable), alias),
            };
        });
    }

    protected override transformDeleteQuery(node: DeleteQueryNode) {
        // all "from" nodes are pushed as scopes
        const scopes = this.createScopesFromFroms(node.from, false);

        // process name mapping in each "from"
        const froms = node.from.froms.map((from) => {
            const { alias, node: innerNode } = this.stripAlias(from);
            if (TableNode.is(innerNode!)) {
                // map table name
                return this.wrapAlias(this.processTableRef(innerNode), alias);
            } else {
                return super.transformNode(from);
            }
        });

        return this.withScopes(scopes, () => {
            return {
                ...super.transformDeleteQuery(node),
                from: FromNode.create(froms),
            };
        });
    }

    // #endregion

    // #region utils

    private resolveFieldFromScopes(name: string, qualifier?: string) {
        for (const scope of this.modelScopes.toReversed()) {
            if (qualifier) {
                if (scope.alias && qualifier !== scope.alias) {
                    continue;
                }
                if (qualifier !== scope.model) {
                    continue;
                }
            }
            const modelDef = getModel(this.schema, scope.model);
            if (!modelDef) {
                continue;
            }
            if (modelDef.fields[name]) {
                return { modelDef, fieldDef: modelDef.fields[name], scope };
            }
        }
        return { modelDef: undefined, fieldDef: undefined, scope: undefined };
    }

    private pushScope(scope: Scope) {
        this.modelScopes.push(scope);
    }

    private withScope<T>(scope: Scope, fn: (...args: unknown[]) => T): T {
        this.pushScope(scope);
        try {
            return fn();
        } finally {
            this.modelScopes.pop();
        }
    }

    private withScopes<T>(scopes: Scope[], fn: (...args: unknown[]) => T): T {
        scopes.forEach((s) => this.pushScope(s));
        try {
            return fn();
        } finally {
            scopes.forEach(() => this.modelScopes.pop());
        }
    }

    private wrapAlias<T extends OperationNode>(node: T, alias: string | undefined) {
        return alias ? AliasNode.create(node, IdentifierNode.create(alias)) : node;
    }

    private ensureAlias(node: OperationNode, alias: string | undefined, fallbackName: string) {
        if (!node) {
            return node;
        }
        return alias
            ? AliasNode.create(node, IdentifierNode.create(alias))
            : AliasNode.create(node, IdentifierNode.create(fallbackName));
    }

    private processTableRef(node: TableNode) {
        if (!node) {
            return node;
        }
        if (!TableNode.is(node)) {
            return super.transformNode(node);
        }
        return TableNode.create(this.mapTableName(node.table.identifier.name));
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

    private mapFieldName(model: string, field: string): string {
        const mappedName = this.fieldToColumnMap.get(`${model}.${field}`);
        if (mappedName) {
            return mappedName;
        } else {
            return field;
        }
    }

    private mapTableName(tableName: string): string {
        const mappedName = this.modelToTableMap.get(tableName);
        if (mappedName) {
            return mappedName;
        } else {
            return tableName;
        }
    }

    private stripAlias(node: OperationNode | undefined) {
        if (!node) {
            return { alias: undefined, node };
        }
        if (AliasNode.is(node)) {
            invariant(IdentifierNode.is(node.alias), 'Expected identifier as alias');
            return { alias: node.alias.name, node: node.node };
        }
        return { alias: undefined, node };
    }

    private hasMappedColumns(modelName: string) {
        return [...this.fieldToColumnMap.keys()].some((key) => key.startsWith(modelName + '.'));
    }

    private createScopesFromFroms(node: FromNode | undefined, namesMapped: boolean) {
        if (!node) {
            return [];
        }
        return node.froms
            .map((from) => {
                const { alias, node: innerNode } = this.stripAlias(from);
                if (innerNode && TableNode.is(innerNode)) {
                    return { model: innerNode.table.identifier.name, alias, namesMapped };
                } else {
                    return undefined;
                }
            })
            .filter((s) => !!s);
    }

    // convert a "from" node to a nested query if there are columns with name mapping
    private processFrom(node: FromNode): FromNode {
        return {
            ...super.transformFrom(node),
            froms: node.froms.map((from) => {
                const { alias, node: innerNode } = this.stripAlias(from);
                if (!innerNode) {
                    return super.transformNode(from);
                }
                if (TableNode.is(innerNode)) {
                    if (this.hasMappedColumns(innerNode.table.identifier.name)) {
                        // create a nested query with all fields selected and names mapped
                        const selectAll = this.createSelectAll(innerNode.table.identifier.name);

                        // use the original alias or table name as the alias for the nested query
                        // so its transparent to the outer scope
                        return this.ensureAlias(selectAll, alias, innerNode.table.identifier.name);
                    }
                }
                return this.transformNode(from);
            }),
        };
    }

    // create a `SelectQueryNode` for the given model with all columns mapped
    private createSelectAll(model: string): SelectQueryNode {
        const modelDef = requireModel(this.schema, model);
        const tableName = this.mapTableName(model);
        return {
            kind: 'SelectQueryNode',
            from: FromNode.create([TableNode.create(tableName)]),
            selections: this.getModelFields(modelDef).map((fieldDef) => {
                const columnName = this.mapFieldName(model, fieldDef.name);
                const columnRef = ReferenceNode.create(ColumnNode.create(columnName), TableNode.create(tableName));
                if (columnName !== fieldDef.name) {
                    const aliased = AliasNode.create(columnRef, IdentifierNode.create(fieldDef.name));
                    return SelectionNode.create(aliased);
                } else {
                    return SelectionNode.create(columnRef);
                }
            }),
        };
    }

    private getModelFields(modelDef: ModelDef) {
        return Object.values(modelDef.fields).filter((f) => !f.relation && !f.computed && !f.originModel);
    }

    private processSelections(selections: readonly SelectionNode[]) {
        const result: SelectionNode[] = [];
        selections.forEach((selection) => {
            if (SelectAllNode.is(selection.selection)) {
                // expand "select *" to a list of selections if name mapping is needed
                const processed = this.processSelectAll(selection.selection);
                if (Array.isArray(processed)) {
                    // expanded and names mapped
                    result.push(...processed.map((s) => SelectionNode.create(s)));
                } else {
                    // not expanded
                    result.push(SelectionNode.create(processed));
                }
            } else {
                result.push(SelectionNode.create(this.processSelection(selection.selection)));
            }
        });
        return result;
    }

    private processSelection(node: AliasNode | ColumnNode | ReferenceNode) {
        let alias: string | undefined;
        if (!AliasNode.is(node)) {
            alias = this.extractFieldName(node);
        }
        const result = super.transformNode(node);
        return this.wrapAlias(result, alias);
    }

    private processSelectAll(node: SelectAllNode) {
        const scope = this.modelScopes[this.modelScopes.length - 1];
        invariant(scope);

        if (!this.hasMappedColumns(scope.model)) {
            // no name mapping needed, preserve the select all
            return super.transformSelectAll(node);
        }

        // expand select all to a list of selections with name mapping
        const modelDef = requireModel(this.schema, scope.model);
        return this.getModelFields(modelDef).map((fieldDef) => {
            const columnName = this.mapFieldName(scope.model, fieldDef.name);
            const columnRef = ReferenceNode.create(ColumnNode.create(columnName));
            return columnName !== fieldDef.name ? this.wrapAlias(columnRef, fieldDef.name) : columnRef;
        });
    }

    private extractFieldName(node: ReferenceNode | ColumnNode) {
        if (ReferenceNode.is(node) && ColumnNode.is(node.column)) {
            return node.column.column.name;
        } else if (ColumnNode.is(node)) {
            return node.column.name;
        } else {
            return undefined;
        }
    }

    // #endregion
}
