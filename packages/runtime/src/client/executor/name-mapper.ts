import { invariant } from '@zenstackhq/common-helpers';
import {
    AliasNode,
    ColumnNode,
    DeleteQueryNode,
    FromNode,
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
import { getModel, requireModel } from '../query-utils';
import { stripAlias } from './kysely-utils';

type Scope = {
    model?: string;
    alias?: string;
    namesMapped?: boolean; // true means fields referring to this scope have their names already mapped
};

export class QueryNameMapper extends OperationNodeTransformer {
    private readonly modelToTableMap = new Map<string, string>();
    private readonly fieldToColumnMap = new Map<string, string>();
    private readonly scopes: Scope[] = [];

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

        // process "from" clauses
        const processedFroms = node.from.froms.map((from) => this.processSelectTable(from));

        // process "join" clauses
        const processedJoins = (node.joins ?? []).map((join) => this.processSelectTable(join.table));

        // merge the scopes of froms and joins since they're all visible in the query body
        const scopes = [...processedFroms.map(({ scope }) => scope), ...processedJoins.map(({ scope }) => scope)];

        return this.withScopes(scopes, () => {
            // transform join clauses, "on" is transformed within the scopes
            const joins = node.joins
                ? node.joins.map((join, i) => ({
                      ...join,
                      table: processedJoins[i]!.node,
                      on: this.transformNode(join.on),
                  }))
                : undefined;
            return {
                ...super.transformSelectQuery(node),
                from: FromNode.create(processedFroms.map((f) => f.node)),
                joins,
                selections: this.processSelectQuerySelections(node),
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

    protected override transformReference(node: ReferenceNode) {
        if (!ColumnNode.is(node.column)) {
            return super.transformReference(node);
        }

        // resolve the reference to a field from outer scopes
        const scope = this.resolveFieldFromScopes(node.column.column.name, node.table?.table.identifier.name);
        if (scope && !scope.namesMapped && scope.model) {
            // map column name and table name as needed
            const mappedFieldName = this.mapFieldName(scope.model, node.column.column.name);

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
        const scope = this.resolveFieldFromScopes(node.column.name);
        if (!scope || scope.namesMapped || !scope.model) {
            return super.transformColumn(node);
        }
        const mappedName = this.mapFieldName(scope.model, node.column.name);
        return ColumnNode.create(mappedName);
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        if (!node.table) {
            return super.transformUpdateQuery(node);
        }

        const { alias, node: innerTable } = stripAlias(node.table);
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
        const scopes: Scope[] = node.from.froms.map((node) => {
            const { alias, node: innerNode } = stripAlias(node);
            return {
                model: this.extractModelName(innerNode),
                alias,
                namesMapped: false,
            };
        });

        // process name mapping in each "from"
        const froms = node.from.froms.map((from) => {
            const { alias, node: innerNode } = stripAlias(from);
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

    private processSelectQuerySelections(node: SelectQueryNode) {
        const selections: SelectionNode[] = [];
        for (const selection of node.selections ?? []) {
            if (SelectAllNode.is(selection.selection)) {
                // expand `selectAll` to all fields with name mapping if the
                // inner-most scope is not already mapped
                const scope = this.scopes[this.scopes.length - 1];
                if (scope?.model && !scope.namesMapped) {
                    selections.push(...this.createSelectAllFields(scope.model, scope.alias));
                } else {
                    selections.push(super.transformSelection(selection));
                }
            } else if (ReferenceNode.is(selection.selection) || ColumnNode.is(selection.selection)) {
                // map column name and add/preserve alias
                const transformed = this.transformNode(selection.selection);
                if (AliasNode.is(transformed)) {
                    // keep the alias if there's one
                    selections.push(SelectionNode.create(transformed));
                } else {
                    // otherwise use an alias to preserve the original field name
                    const origFieldName = this.extractFieldName(selection.selection);
                    const fieldName = this.extractFieldName(transformed);
                    if (fieldName !== origFieldName) {
                        selections.push(SelectionNode.create(this.wrapAlias(transformed, origFieldName)));
                    } else {
                        selections.push(SelectionNode.create(transformed));
                    }
                }
            } else {
                selections.push(super.transformSelection(selection));
            }
        }
        return selections;
    }

    private resolveFieldFromScopes(name: string, qualifier?: string) {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const scope = this.scopes[i]!;
            if (qualifier) {
                // if the field as a qualifier, the qualifier must match the scope's
                // alias if any, or model if no alias
                if (scope.alias) {
                    if (scope.alias === qualifier) {
                        // scope has an alias that matches the qualifier
                        return scope;
                    } else {
                        // scope has an alias but it doesn't match the qualifier
                        continue;
                    }
                } else if (scope.model) {
                    if (scope.model === qualifier) {
                        // scope has a model that matches the qualifier
                        return scope;
                    } else {
                        // scope has a model but it doesn't match the qualifier
                        continue;
                    }
                }
            } else {
                // if the field has no qualifier, match with model name
                if (scope.model) {
                    const modelDef = getModel(this.schema, scope.model);
                    if (!modelDef) {
                        continue;
                    }
                    if (modelDef.fields[name]) {
                        return scope;
                    }
                }
            }
        }
        return undefined;
    }

    private pushScope(scope: Scope) {
        this.scopes.push(scope);
    }

    private withScope<T>(scope: Scope, fn: (...args: unknown[]) => T): T {
        this.pushScope(scope);
        try {
            return fn();
        } finally {
            this.scopes.pop();
        }
    }

    private withScopes<T>(scopes: Scope[], fn: (...args: unknown[]) => T): T {
        scopes.forEach((s) => this.pushScope(s));
        try {
            return fn();
        } finally {
            scopes.forEach(() => this.scopes.pop());
        }
    }

    private wrapAlias<T extends OperationNode>(node: T, alias: string | undefined) {
        return alias ? AliasNode.create(node, IdentifierNode.create(alias)) : node;
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

    private hasMappedColumns(modelName: string) {
        return [...this.fieldToColumnMap.keys()].some((key) => key.startsWith(modelName + '.'));
    }

    // convert a "from" node to a nested query if there are columns with name mapping
    private processSelectTable(node: OperationNode): { node: OperationNode; scope: Scope } {
        const { alias, node: innerNode } = stripAlias(node);
        if (innerNode && TableNode.is(innerNode)) {
            // if the selection is a table, map its name and create alias to preserve model name,
            // mark the scope as names NOT mapped if the model has field name mappings, so that
            // inner transformations will map column names
            const modelName = innerNode.table.identifier.name;
            const mappedName = this.mapTableName(modelName);
            const finalAlias = alias ?? (mappedName !== modelName ? modelName : undefined);
            return {
                node: this.wrapAlias(TableNode.create(mappedName), finalAlias),
                scope: {
                    alias: alias ?? modelName,
                    model: modelName,
                    namesMapped: !this.hasMappedColumns(modelName),
                },
            };
        } else {
            // otherwise, it's an alias or a sub-query, in which case the inner field names are
            // already mapped, so we just create a scope with the alias and mark names mapped
            return {
                node: super.transformNode(node),
                scope: {
                    alias,
                    model: undefined,
                    namesMapped: true,
                },
            };
        }
    }

    private createSelectAllFields(model: string, alias: string | undefined) {
        const modelDef = requireModel(this.schema, model);
        return this.getModelFields(modelDef).map((fieldDef) => {
            const columnName = this.mapFieldName(model, fieldDef.name);
            const columnRef = ReferenceNode.create(
                ColumnNode.create(columnName),
                alias ? TableNode.create(alias) : undefined,
            );
            if (columnName !== fieldDef.name) {
                const aliased = AliasNode.create(columnRef, IdentifierNode.create(fieldDef.name));
                return SelectionNode.create(aliased);
            } else {
                return SelectionNode.create(columnRef);
            }
        });
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
        const scope = this.scopes[this.scopes.length - 1];
        invariant(scope);

        if (!scope.model || !this.hasMappedColumns(scope.model)) {
            // no name mapping needed, preserve the select all
            return super.transformSelectAll(node);
        }

        // expand select all to a list of selections with name mapping
        const modelDef = requireModel(this.schema, scope.model);
        return this.getModelFields(modelDef).map((fieldDef) => {
            const columnName = this.mapFieldName(modelDef.name, fieldDef.name);
            const columnRef = ReferenceNode.create(ColumnNode.create(columnName));
            return columnName !== fieldDef.name ? this.wrapAlias(columnRef, fieldDef.name) : columnRef;
        });
    }

    private extractModelName(node: OperationNode): string | undefined {
        const { node: innerNode } = stripAlias(node);
        return TableNode.is(innerNode!) ? innerNode!.table.identifier.name : undefined;
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
