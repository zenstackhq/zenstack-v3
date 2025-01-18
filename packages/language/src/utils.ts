import {
    AstUtils,
    URI,
    type AstNode,
    type LangiumDocuments,
    type Reference,
} from 'langium';
import path from 'path';
import { STD_LIB_MODULE_NAME, type ExpressionContext } from './constants';
import {
    ConfigExpr,
    isArrayExpr,
    isConfigArrayExpr,
    isDataModel,
    isDataModelField,
    isEnumField,
    isExpression,
    isInvocationExpr,
    isLiteralExpr,
    isMemberAccessExpr,
    isModel,
    isObjectExpr,
    isReferenceExpr,
    isStringLiteral,
    isTypeDef,
    isTypeDefField,
    Model,
    ModelImport,
    ReferenceExpr,
    type Attribute,
    type AttributeParam,
    type BuiltinType,
    type DataModel,
    type DataModelAttribute,
    type DataModelField,
    type DataModelFieldAttribute,
    type Enum,
    type EnumField,
    type Expression,
    type ExpressionType,
    type FunctionDecl,
    type TypeDef,
    type TypeDefField,
} from './generated/ast';

export type AttributeTarget =
    | DataModel
    | TypeDef
    | DataModelField
    | TypeDefField
    | Enum
    | EnumField
    | FunctionDecl
    | Attribute
    | AttributeParam;

export function hasAttribute(decl: AttributeTarget, name: string) {
    return !!getAttribute(decl, name);
}

export function getAttribute(decl: AttributeTarget, name: string) {
    return (
        decl.attributes as (DataModelAttribute | DataModelFieldAttribute)[]
    ).find((attr) => attr.decl.$refText === name);
}

export function isFromStdlib(node: AstNode) {
    const model = AstUtils.getContainerOfType(node, isModel);
    return (
        !!model &&
        !!model.$document &&
        model.$document.uri.path.endsWith(STD_LIB_MODULE_NAME)
    );
}

export function isAuthInvocation(node: AstNode) {
    return (
        isInvocationExpr(node) &&
        node.function.ref?.name === 'auth' &&
        isFromStdlib(node.function.ref)
    );
}

/**
 * Try getting string value from a potential string literal expression
 */
export function getStringLiteral(
    node: AstNode | undefined
): string | undefined {
    return isStringLiteral(node) ? node.value : undefined;
}

const isoDateTimeRegex =
    /^\d{4}(-\d\d(-\d\d(T\d\d:\d\d(:\d\d)?(\.\d+)?(([+-]\d\d:\d\d)|Z)?)?)?)?$/i;

/**
 * Determines if the given sourceType is assignable to a destination of destType
 */
export function typeAssignable(
    destType: ExpressionType,
    sourceType: ExpressionType,
    sourceExpr?: Expression
): boolean {
    // implicit conversion from ISO datetime string to datetime
    if (
        destType === 'DateTime' &&
        sourceType === 'String' &&
        sourceExpr &&
        isStringLiteral(sourceExpr)
    ) {
        const literal = getStringLiteral(sourceExpr);
        if (literal && isoDateTimeRegex.test(literal)) {
            // implicitly convert to DateTime
            sourceType = 'DateTime';
        }
    }

    switch (destType) {
        case 'Any':
            return true;
        case 'Float':
            return (
                sourceType === 'Any' ||
                sourceType === 'Int' ||
                sourceType === 'Float'
            );
        default:
            return sourceType === 'Any' || sourceType === destType;
    }
}

/**
 * Maps a ZModel builtin type to expression type
 */
export function mapBuiltinTypeToExpressionType(
    type: BuiltinType | 'Any' | 'Object' | 'Null' | 'Unsupported'
): ExpressionType | 'Any' {
    switch (type) {
        case 'Any':
        case 'Boolean':
        case 'String':
        case 'DateTime':
        case 'Int':
        case 'Float':
        case 'Null':
            return type;
        case 'BigInt':
            return 'Int';
        case 'Decimal':
            return 'Float';
        case 'Json':
        case 'Bytes':
            return 'Any';
        case 'Object':
            return 'Object';
        case 'Unsupported':
            return 'Unsupported';
    }
}

export function isAuthOrAuthMemberAccess(expr: Expression): boolean {
    return (
        isAuthInvocation(expr) ||
        (isMemberAccessExpr(expr) && isAuthOrAuthMemberAccess(expr.operand))
    );
}

export function isEnumFieldReference(node: AstNode): node is ReferenceExpr {
    return isReferenceExpr(node) && isEnumField(node.target.ref);
}

export function isDataModelFieldReference(
    node: AstNode
): node is ReferenceExpr {
    return isReferenceExpr(node) && isDataModelField(node.target.ref);
}

/**
 * Returns if the given field is a relation field.
 */
export function isRelationshipField(field: DataModelField) {
    return isDataModel(field.type.reference?.ref);
}

export function isFutureExpr(node: AstNode) {
    return (
        isInvocationExpr(node) &&
        node.function.ref?.name === 'future' &&
        isFromStdlib(node.function.ref)
    );
}

export function isDelegateModel(node: AstNode) {
    return isDataModel(node) && hasAttribute(node, '@@delegate');
}

export function resolved<T extends AstNode>(ref: Reference<T>): T {
    if (!ref.ref) {
        throw new Error(`Reference not resolved: ${ref.$refText}`);
    }
    return ref.ref;
}

/**
 * Walk up the inheritance chain to find the path from the start model to the target model
 */
export function findUpInheritance(
    start: DataModel,
    target: DataModel
): DataModel[] | undefined {
    for (const base of start.superTypes) {
        if (base.ref === target) {
            return [base.ref];
        }
        const path = findUpInheritance(base.ref as DataModel, target);
        if (path) {
            return [base.ref as DataModel, ...path];
        }
    }
    return undefined;
}

export function getModelFieldsWithBases(
    model: DataModel,
    includeDelegate = true
) {
    if (model.$baseMerged) {
        return model.fields;
    } else {
        return [
            ...model.fields,
            ...getRecursiveBases(model, includeDelegate).flatMap(
                (base) => base.fields
            ),
        ];
    }
}

export function getRecursiveBases(
    dataModel: DataModel,
    includeDelegate = true,
    seen = new Set<DataModel>()
): DataModel[] {
    const result: DataModel[] = [];
    if (seen.has(dataModel)) {
        return result;
    }
    seen.add(dataModel);
    dataModel.superTypes.forEach((superType) => {
        const baseDecl = superType.ref;
        if (baseDecl) {
            if (!includeDelegate && isDelegateModel(baseDecl)) {
                return;
            }
            result.push(baseDecl);
            result.push(...getRecursiveBases(baseDecl, includeDelegate, seen));
        }
    });
    return result;
}

/**
 * Gets `@@id` fields declared at the data model level (including search in base models)
 */
export function getModelIdFields(model: DataModel) {
    const modelsToCheck = model.$baseMerged
        ? [model]
        : [model, ...getRecursiveBases(model)];

    for (const modelToCheck of modelsToCheck) {
        const idAttr = modelToCheck.attributes.find(
            (attr) => attr.decl.$refText === '@@id'
        );
        if (!idAttr) {
            continue;
        }
        const fieldsArg = idAttr.args.find(
            (a) => a.$resolvedParam?.name === 'fields'
        );
        if (!fieldsArg || !isArrayExpr(fieldsArg.value)) {
            continue;
        }

        return fieldsArg.value.items
            .filter((item): item is ReferenceExpr => isReferenceExpr(item))
            .map((item) => resolved(item.target) as DataModelField);
    }

    return [];
}

/**
 * Gets `@@unique` fields declared at the data model level (including search in base models)
 */
export function getModelUniqueFields(model: DataModel) {
    const modelsToCheck = model.$baseMerged
        ? [model]
        : [model, ...getRecursiveBases(model)];

    for (const modelToCheck of modelsToCheck) {
        const uniqueAttr = modelToCheck.attributes.find(
            (attr) => attr.decl.$refText === '@@unique'
        );
        if (!uniqueAttr) {
            continue;
        }
        const fieldsArg = uniqueAttr.args.find(
            (a) => a.$resolvedParam?.name === 'fields'
        );
        if (!fieldsArg || !isArrayExpr(fieldsArg.value)) {
            continue;
        }

        return fieldsArg.value.items
            .filter((item): item is ReferenceExpr => isReferenceExpr(item))
            .map((item) => resolved(item.target) as DataModelField);
    }

    return [];
}

/**
 * Gets lists of unique fields declared at the data model level
 *
 * TODO: merge this with {@link getModelUniqueFields}
 */
export function getUniqueFields(model: DataModel) {
    const uniqueAttrs = model.attributes.filter(
        (attr) =>
            attr.decl.ref?.name === '@@unique' || attr.decl.ref?.name === '@@id'
    );
    return uniqueAttrs.map((uniqueAttr) => {
        const fieldsArg = uniqueAttr.args.find(
            (a) => a.$resolvedParam?.name === 'fields'
        );
        if (!fieldsArg || !isArrayExpr(fieldsArg.value)) {
            return [];
        }

        return fieldsArg.value.items
            .filter((item): item is ReferenceExpr => isReferenceExpr(item))
            .map((item) => resolved(item.target) as DataModelField);
    });
}

export function findUpAst(
    node: AstNode,
    predicate: (node: AstNode) => boolean
): AstNode | undefined {
    let curr: AstNode | undefined = node;
    while (curr) {
        if (predicate(curr)) {
            return curr;
        }
        curr = curr.$container;
    }
    return undefined;
}

export function getLiteral<T extends string | number | boolean | any = any>(
    expr: Expression | ConfigExpr | undefined
): T | undefined {
    switch (expr?.$type) {
        case 'ObjectExpr':
            return getObjectLiteral<T>(expr);
        case 'StringLiteral':
        case 'BooleanLiteral':
            return expr.value as T;
        case 'NumberLiteral':
            return parseFloat(expr.value) as T;
        default:
            return undefined;
    }
}

export function getObjectLiteral<T>(
    expr: Expression | ConfigExpr | undefined
): T | undefined {
    if (!expr || !isObjectExpr(expr)) {
        return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const field of expr.fields) {
        let fieldValue: unknown;
        if (isLiteralExpr(field.value)) {
            fieldValue = getLiteral(field.value);
        } else if (isArrayExpr(field.value)) {
            fieldValue = getLiteralArray(field.value);
        } else if (isObjectExpr(field.value)) {
            fieldValue = getObjectLiteral(field.value);
        }
        if (fieldValue === undefined) {
            return undefined;
        } else {
            result[field.name] = fieldValue;
        }
    }
    return result as T;
}

export function getLiteralArray<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends string | number | boolean | any = any
>(expr: Expression | ConfigExpr | undefined): T[] | undefined {
    const arr = getArray(expr);
    if (!arr) {
        return undefined;
    }
    return arr
        .map((item) => isExpression(item) && getLiteral<T>(item))
        .filter((v): v is T => v !== undefined);
}

function getArray(expr: Expression | ConfigExpr | undefined) {
    return isArrayExpr(expr) || isConfigArrayExpr(expr)
        ? expr.items
        : undefined;
}

export function getAttributeArgLiteral<T extends string | number | boolean>(
    attr: DataModelAttribute | DataModelFieldAttribute,
    name: string
): T | undefined {
    for (const arg of attr.args) {
        if (arg.$resolvedParam?.name === name) {
            return getLiteral<T>(arg.value);
        }
    }
    return undefined;
}

export function getFunctionExpressionContext(funcDecl: FunctionDecl) {
    const funcAllowedContext: ExpressionContext[] = [];
    const funcAttr = funcDecl.attributes.find(
        (attr) => attr.decl.$refText === '@@@expressionContext'
    );
    if (funcAttr) {
        const contextArg = funcAttr.args[0]?.value;
        if (isArrayExpr(contextArg)) {
            contextArg.items.forEach((item) => {
                if (isEnumFieldReference(item)) {
                    funcAllowedContext.push(
                        item.target.$refText as ExpressionContext
                    );
                }
            });
        }
    }
    return funcAllowedContext;
}

export function getFieldReference(
    expr: Expression
): DataModelField | TypeDefField | undefined {
    if (
        isReferenceExpr(expr) &&
        (isDataModelField(expr.target.ref) || isTypeDefField(expr.target.ref))
    ) {
        return expr.target.ref;
    } else if (
        isMemberAccessExpr(expr) &&
        (isDataModelField(expr.member.ref) || isTypeDefField(expr.member.ref))
    ) {
        return expr.member.ref;
    } else {
        return undefined;
    }
}

export function isCheckInvocation(node: AstNode) {
    return (
        isInvocationExpr(node) &&
        node.function.ref?.name === 'check' &&
        isFromStdlib(node.function.ref)
    );
}

export async function resolveTransitiveImports(
    documents: LangiumDocuments,
    model: Model
): Promise<Model[]> {
    return resolveTransitiveImportsInternal(documents, model);
}

async function resolveTransitiveImportsInternal(
    documents: LangiumDocuments,
    model: Model,
    initialModel = model,
    visited: Set<string> = new Set(),
    models: Set<Model> = new Set()
) {
    const doc = AstUtils.getDocument(model);
    const initialDoc = AstUtils.getDocument(initialModel);

    if (initialDoc.uri.fsPath.toLowerCase() !== doc.uri.fsPath.toLowerCase()) {
        models.add(model);
    }

    const normalizedPath = doc.uri.fsPath.toLowerCase();
    if (!visited.has(normalizedPath)) {
        visited.add(normalizedPath);
        for (const imp of model.imports) {
            const importedModel = await resolveImport(documents, imp);
            if (importedModel) {
                resolveTransitiveImportsInternal(
                    documents,
                    importedModel,
                    initialModel,
                    visited,
                    models
                );
            }
        }
    }
    return Array.from(models);
}

export async function resolveImport(
    documents: LangiumDocuments,
    imp: ModelImport
): Promise<Model | undefined> {
    const resolvedUri = await resolveImportUri(imp);
    try {
        if (resolvedUri) {
            const resolvedDocument = await documents.getOrCreateDocument(
                resolvedUri
            );
            const node = resolvedDocument.parseResult.value;
            if (isModel(node)) {
                return node;
            }
        }
    } catch {
        // NOOP
    }
    return undefined;
}

async function resolveImportUri(imp: ModelImport): Promise<URI | undefined> {
    if (!imp.path) return undefined; // This will return true if imp.path is undefined, null, or an empty string ("").

    if (!imp.path.endsWith('.zmodel')) {
        imp.path += '.zmodel';
    }

    if (
        !imp.path.startsWith('.') && // Respect relative paths
        !path.isAbsolute(imp.path) // Respect Absolute paths
    ) {
        // use the current model's path as the search context
        const contextPath = imp.$container.$document
            ? path.dirname(imp.$container.$document.uri.fsPath)
            : process.cwd();
        imp.path = findNodeModulesFile(imp.path, contextPath) ?? imp.path;
    }

    const doc = await AstUtils.getDocument(imp);
    const dir = path.dirname(doc.uri.fsPath);
    return URI.file(path.resolve(dir, imp.path));
}

export function findNodeModulesFile(name: string, cwd: string = process.cwd()) {
    if (!name) return undefined;
    try {
        // Use require.resolve to find the module/file. The paths option allows specifying the directory to start from.
        const resolvedPath = require.resolve(name, { paths: [cwd] });
        return resolvedPath;
    } catch (error) {
        // If require.resolve fails to find the module/file, it will throw an error.
        return undefined;
    }
}

/**
 * Gets data models and type defs in the ZModel schema.
 */
export function getDataModelAndTypeDefs(model: Model, includeIgnored = false) {
    const r = model.declarations.filter(
        (d): d is DataModel | TypeDef => isDataModel(d) || isTypeDef(d)
    );
    if (includeIgnored) {
        return r;
    } else {
        return r.filter((model) => !hasAttribute(model, '@@ignore'));
    }
}

export async function getAllDeclarationsIncludingImports(
    documents: LangiumDocuments,
    model: Model
) {
    const imports = await resolveTransitiveImports(documents, model);
    return model.declarations.concat(...imports.map((imp) => imp.declarations));
}
