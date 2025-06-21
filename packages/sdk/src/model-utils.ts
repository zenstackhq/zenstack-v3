import {
    isArrayExpr,
    isDataModel,
    isLiteralExpr,
    isModel,
    isReferenceExpr,
    Model,
    ReferenceExpr,
    type AstNode,
    type Attribute,
    type AttributeParam,
    type DataModel,
    type DataModelAttribute,
    type DataModelField,
    type DataModelFieldAttribute,
    type Enum,
    type EnumField,
    type FunctionDecl,
    type Reference,
    type TypeDef,
    type TypeDefField,
} from '@zenstackhq/language/ast';

export function isIdField(field: DataModelField) {
    // field-level @id attribute
    if (hasAttribute(field, '@id')) {
        return true;
    }

    // NOTE: we have to use name to match fields because the fields
    // may be inherited from an abstract base and have cloned identities

    const model = field.$container as DataModel;

    // model-level @@id attribute with a list of fields
    const modelLevelIds = getModelIdFields(model);
    if (modelLevelIds.map((f) => f.name).includes(field.name)) {
        return true;
    }

    if (model.fields.some((f) => hasAttribute(f, '@id')) || modelLevelIds.length > 0) {
        // the model already has id field, don't check @unique and @@unique
        return false;
    }

    // then, the first field with @unique can be used as id
    const firstUniqueField = model.fields.find((f) => hasAttribute(f, '@unique'));
    if (firstUniqueField) {
        return firstUniqueField.name === field.name;
    }

    // last, the first model level @@unique can be used as id
    const modelLevelUnique = getModelUniqueFields(model);
    if (modelLevelUnique.map((f) => f.name).includes(field.name)) {
        return true;
    }

    return false;
}

export function hasAttribute(
    decl: DataModel | TypeDef | DataModelField | Enum | EnumField | FunctionDecl | Attribute | AttributeParam,
    name: string,
) {
    return !!getAttribute(decl, name);
}

export function getAttribute(
    decl:
        | DataModel
        | TypeDef
        | DataModelField
        | TypeDefField
        | Enum
        | EnumField
        | FunctionDecl
        | Attribute
        | AttributeParam,
    name: string,
) {
    return (decl.attributes as (DataModelAttribute | DataModelFieldAttribute)[]).find(
        (attr) => attr.decl.$refText === name,
    );
}

/**
 * Gets `@@id` fields declared at the data model level (including search in base models)
 */
export function getModelIdFields(model: DataModel) {
    const modelsToCheck = model.$baseMerged ? [model] : [model, ...getRecursiveBases(model)];

    for (const modelToCheck of modelsToCheck) {
        const idAttr = modelToCheck.attributes.find((attr) => attr.decl.$refText === '@@id');
        if (!idAttr) {
            continue;
        }
        const fieldsArg = idAttr.args.find((a) => a.$resolvedParam?.name === 'fields');
        if (!fieldsArg || !isArrayExpr(fieldsArg.value)) {
            continue;
        }

        return fieldsArg.value.items
            .filter((item): item is ReferenceExpr => isReferenceExpr(item))
            .map((item) => item.target.ref as DataModelField);
    }

    return [];
}

/**
 * Gets `@@unique` fields declared at the data model level (including search in base models)
 */
export function getModelUniqueFields(model: DataModel) {
    const modelsToCheck = model.$baseMerged ? [model] : [model, ...getRecursiveBases(model)];

    for (const modelToCheck of modelsToCheck) {
        const uniqueAttr = modelToCheck.attributes.find((attr) => attr.decl.$refText === '@@unique');
        if (!uniqueAttr) {
            continue;
        }
        const fieldsArg = uniqueAttr.args.find((a) => a.$resolvedParam?.name === 'fields');
        if (!fieldsArg || !isArrayExpr(fieldsArg.value)) {
            continue;
        }

        return fieldsArg.value.items
            .filter((item): item is ReferenceExpr => isReferenceExpr(item))
            .map((item) => item.target.ref as DataModelField);
    }

    return [];
}

export function getRecursiveBases(
    dataModel: DataModel,
    includeDelegate = true,
    seen = new Set<DataModel>(),
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

export function isDelegateModel(node: AstNode) {
    return isDataModel(node) && hasAttribute(node, '@@delegate');
}

export function isUniqueField(field: DataModelField) {
    if (hasAttribute(field, '@unique')) {
        return true;
    }
    const modelIds = getAttribute(field.$container, '@@unique');
    if (modelIds && modelIds.args.some((arg) => isLiteralExpr(arg.value) && arg.value.value === field.name)) {
        return true;
    }
    return false;
}

export function isFromStdlib(node: AstNode) {
    const model = getContainingModel(node);
    return !!model && !!model.$document && model.$document.uri.path.endsWith('stdlib.zmodel');
}

export function getContainingModel(node: AstNode | undefined): Model | null {
    if (!node) {
        return null;
    }
    return isModel(node) ? node : getContainingModel(node.$container);
}

export function resolved<T extends AstNode>(ref: Reference<T>): T {
    if (!ref.ref) {
        throw new Error(`Reference not resolved: ${ref.$refText}`);
    }
    return ref.ref;
}

export function getAuthDecl(model: Model) {
    let found = model.declarations.find(
        (d) => isDataModel(d) && d.attributes.some((attr) => attr.decl.$refText === '@@auth'),
    );
    if (!found) {
        found = model.declarations.find((d) => isDataModel(d) && d.name === 'User');
    }
    return found;
}
