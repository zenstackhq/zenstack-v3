import {
    isDataModel,
    isLiteralExpr,
    isModel,
    isTypeDef,
    type AstNode,
    type Attribute,
    type AttributeParam,
    type DataField,
    type DataFieldAttribute,
    type DataModel,
    type DataModelAttribute,
    type Enum,
    type EnumField,
    type FunctionDecl,
    type Model,
    type Reference,
    type TypeDef,
} from '@zenstackhq/language/ast';

import { getAllFields, getModelIdFields, getModelUniqueFields, type AttributeTarget } from '@zenstackhq/language/utils';

export function isIdField(field: DataField, contextModel: DataModel) {
    // field-level @id attribute
    if (hasAttribute(field, '@id')) {
        return true;
    }

    // NOTE: we have to use name to match fields because the fields
    // may be inherited from an abstract base and have cloned identities

    // model-level @@id attribute with a list of fields
    const modelLevelIds = getModelIdFields(contextModel);
    if (modelLevelIds.map((f) => f.name).includes(field.name)) {
        return true;
    }

    const allFields = getAllFields(contextModel);
    if (allFields.some((f) => hasAttribute(f, '@id')) || modelLevelIds.length > 0) {
        // the model already has id field, don't check @unique and @@unique
        return false;
    }

    // then, the first field with @unique can be used as id
    const firstUniqueField = allFields.find((f) => hasAttribute(f, '@unique'));
    if (firstUniqueField) {
        return firstUniqueField.name === field.name;
    }

    // last, the first model level @@unique can be used as id
    const modelLevelUnique = getModelUniqueFields(contextModel);
    if (modelLevelUnique.map((f) => f.name).includes(field.name)) {
        return true;
    }

    return false;
}

export function hasAttribute(
    decl: DataModel | TypeDef | DataField | Enum | EnumField | FunctionDecl | Attribute | AttributeParam,
    name: string,
) {
    return !!getAttribute(decl, name);
}

export function getAttribute(decl: AttributeTarget, name: string) {
    return (decl.attributes as (DataModelAttribute | DataFieldAttribute)[]).find((attr) => attr.decl.$refText === name);
}

export function isDelegateModel(node: AstNode) {
    return isDataModel(node) && hasAttribute(node, '@@delegate');
}

export function isUniqueField(field: DataField) {
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
        (d) => (isDataModel(d) || isTypeDef(d)) && d.attributes.some((attr) => attr.decl.$refText === '@@auth'),
    );
    if (!found) {
        found = model.declarations.find((d) => isDataModel(d) && d.name === 'User');
    }
    return found;
}

export function getIdFields(dm: DataModel) {
    return getAllFields(dm)
        .filter((f) => isIdField(f, dm))
        .map((f) => f.name);
}

/**
 * Prefix for auxiliary relation fields generated for delegated models
 */
export const DELEGATE_AUX_RELATION_PREFIX = 'delegate_aux';
