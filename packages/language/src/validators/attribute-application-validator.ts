import { AstUtils, type ValidationAcceptor } from 'langium';
import pluralize from 'pluralize';
import type { BinaryExpr, DataModel, Expression } from '../ast';
import {
    ArrayExpr,
    Attribute,
    AttributeArg,
    AttributeParam,
    DataField,
    DataFieldAttribute,
    DataModelAttribute,
    InternalAttribute,
    ReferenceExpr,
    isArrayExpr,
    isAttribute,
    isDataField,
    isDataModel,
    isEnum,
    isReferenceExpr,
    isTypeDef,
} from '../generated/ast';
import {
    getAllAttributes,
    getStringLiteral,
    hasAttribute,
    isAuthOrAuthMemberAccess,
    isBeforeInvocation,
    isCollectionPredicate,
    isDataFieldReference,
    isDelegateModel,
    isRelationshipField,
    mapBuiltinTypeToExpressionType,
    resolved,
    typeAssignable,
} from '../utils';
import type { AstValidator } from './common';

// a registry of function handlers marked with @check
const attributeCheckers = new Map<string, PropertyDescriptor>();

// function handler decorator
function check(name: string) {
    return function (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) {
        if (!attributeCheckers.get(name)) {
            attributeCheckers.set(name, descriptor);
        }
        return descriptor;
    };
}

type AttributeApplication = DataModelAttribute | DataFieldAttribute | InternalAttribute;

/**
 * Validates function declarations.
 */
export default class AttributeApplicationValidator implements AstValidator<AttributeApplication> {
    validate(attr: AttributeApplication, accept: ValidationAcceptor, contextDataModel?: DataModel) {
        const decl = attr.decl.ref;
        if (!decl) {
            return;
        }

        const targetDecl = attr.$container;
        if (decl.name === '@@@targetField' && !isAttribute(targetDecl)) {
            accept('error', `attribute "${decl.name}" can only be used on attribute declarations`, { node: attr });
            return;
        }

        if (isDataField(targetDecl) && !isValidAttributeTarget(decl, targetDecl)) {
            accept('error', `attribute "${decl.name}" cannot be used on this type of field`, { node: attr });
        }

        this.checkDeprecation(attr, accept);
        this.checkDuplicatedAttributes(attr, accept, contextDataModel);

        const filledParams = new Set<AttributeParam>();

        for (const arg of attr.args) {
            let paramDecl: AttributeParam | undefined;
            if (!arg.name) {
                paramDecl = decl.params.find((p) => p.default && !filledParams.has(p));
                if (!paramDecl) {
                    accept('error', `Unexpected unnamed argument`, {
                        node: arg,
                    });
                    return;
                }
            } else {
                paramDecl = decl.params.find((p) => p.name === arg.name);
                if (!paramDecl) {
                    accept('error', `Attribute "${decl.name}" doesn't have a parameter named "${arg.name}"`, {
                        node: arg,
                    });
                    return;
                }
            }

            if (!assignableToAttributeParam(arg, paramDecl, attr)) {
                accept('error', `Value is not assignable to parameter`, {
                    node: arg,
                });
                return;
            }

            if (filledParams.has(paramDecl)) {
                accept('error', `Parameter "${paramDecl.name}" is already provided`, { node: arg });
                return;
            }
            filledParams.add(paramDecl);
            arg.$resolvedParam = paramDecl;
        }

        const missingParams = decl.params.filter((p) => !p.type.optional && !filledParams.has(p));
        if (missingParams.length > 0) {
            accept(
                'error',
                `Required ${pluralize('parameter', missingParams.length)} not provided: ${missingParams
                    .map((p) => p.name)
                    .join(', ')}`,
                { node: attr },
            );
            return;
        }

        // run checkers for specific attributes
        const checker = attributeCheckers.get(decl.name);
        if (checker) {
            checker.value.call(this, attr, accept);
        }
    }

    private checkDeprecation(attr: AttributeApplication, accept: ValidationAcceptor) {
        const deprecateAttr = attr.decl.ref?.attributes.find((a) => a.decl.ref?.name === '@@@deprecated');
        if (deprecateAttr) {
            const message =
                getStringLiteral(deprecateAttr.args[0]?.value) ?? `Attribute "${attr.decl.ref?.name}" is deprecated`;
            accept('warning', message, { node: attr });
        }
    }

    private checkDuplicatedAttributes(
        attr: AttributeApplication,
        accept: ValidationAcceptor,
        contextDataModel?: DataModel,
    ) {
        const attrDecl = attr.decl.ref;
        if (!attrDecl?.attributes.some((a) => a.decl.ref?.name === '@@@once')) {
            return;
        }

        const allAttributes = contextDataModel ? getAllAttributes(contextDataModel) : attr.$container.attributes;
        const duplicates = allAttributes.filter((a) => a.decl.ref === attrDecl && a !== attr);
        if (duplicates.length > 0) {
            accept('error', `Attribute "${attrDecl.name}" can only be applied once`, { node: attr });
        }
    }

    // TODO: design a way to let plugin register validation
    @check('@@allow')
    @check('@@deny')
    private _checkModelLevelPolicy(attr: AttributeApplication, accept: ValidationAcceptor) {
        const kind = getStringLiteral(attr.args[0]?.value);
        if (!kind) {
            accept('error', `expects a string literal`, {
                node: attr.args[0]!,
            });
            return;
        }
        this.validatePolicyKinds(kind, ['create', 'read', 'update', 'post-update', 'delete', 'all'], attr, accept);

        if ((kind === 'create' || kind === 'all') && attr.args[1]?.value) {
            // "create" rules cannot access non-owned relations because the entity does not exist yet, so
            // there can't possibly be a fk that points to it
            this.rejectNonOwnedRelationInExpression(attr.args[1].value, accept);
        }

        if (kind !== 'post-update' && attr.args[1]?.value) {
            const beforeCall = AstUtils.streamAst(attr.args[1]?.value).find(isBeforeInvocation);
            if (beforeCall) {
                accept('error', `"before()" is only allowed in "post-update" policy rules`, { node: beforeCall });
            }
        }
    }

    private rejectNonOwnedRelationInExpression(expr: Expression, accept: ValidationAcceptor) {
        const contextModel = AstUtils.getContainerOfType(expr, isDataModel);
        if (!contextModel) {
            return;
        }

        if (
            AstUtils.streamAst(expr).some((node) => {
                if (!isDataFieldReference(node)) {
                    // not a field reference, skip
                    return false;
                }

                // referenced field is not a member of the context model, skip
                if (node.target.ref?.$container !== contextModel) {
                    return false;
                }

                const field = node.target.ref as DataField;
                if (!isRelationshipField(field)) {
                    // not a relation, skip
                    return false;
                }

                if (isAuthOrAuthMemberAccess(node)) {
                    // field reference is from auth() or access from auth(), not a relation query
                    return false;
                }

                // check if the the node is a reference inside a collection predicate scope by auth access,
                // e.g., `auth().foo?[x > 0]`

                // make sure to skip the current level if the node is already an LHS of a collection predicate,
                // otherwise we're just circling back to itself when visiting the parent
                const startNode =
                    isCollectionPredicate(node.$container) && (node.$container as BinaryExpr).left === node
                        ? node.$container
                        : node;
                const collectionPredicate = AstUtils.getContainerOfType(startNode.$container, isCollectionPredicate);
                if (collectionPredicate && isAuthOrAuthMemberAccess(collectionPredicate.left)) {
                    return false;
                }

                const relationAttr = field.attributes.find((attr) => attr.decl.ref?.name === '@relation');
                if (!relationAttr) {
                    // no "@relation", not owner side of the relation, match
                    return true;
                }

                if (!relationAttr.args.some((arg) => arg.name === 'fields')) {
                    // no "fields" argument, can't be owner side of the relation, match
                    return true;
                }

                return false;
            })
        ) {
            accept('error', `non-owned relation fields are not allowed in "create" rules`, { node: expr });
        }
    }

    // TODO: design a way to let plugin register validation
    @check('@allow')
    @check('@deny')
    private _checkFieldLevelPolicy(attr: AttributeApplication, accept: ValidationAcceptor) {
        const kind = getStringLiteral(attr.args[0]?.value);
        if (!kind) {
            accept('error', `expects a string literal`, {
                node: attr.args[0]!,
            });
            return;
        }
        const kindItems = this.validatePolicyKinds(kind, ['read', 'update', 'all'], attr, accept);

        const expr = attr.args[1]?.value;
        if (expr && AstUtils.streamAst(expr).some((node) => isBeforeInvocation(node))) {
            accept('error', `"before()" is not allowed in field-level policy rules`, { node: expr });
        }

        // 'update' rules are not allowed for relation fields
        if (kindItems.includes('update') || kindItems.includes('all')) {
            const field = attr.$container as DataField;
            if (isRelationshipField(field)) {
                accept(
                    'error',
                    `Field-level policy rules with "update" or "all" kind are not allowed for relation fields. Put rules on foreign-key fields instead.`,
                    { node: attr },
                );
            }
        }
    }

    @check('@@validate')
    private _checkValidate(attr: AttributeApplication, accept: ValidationAcceptor) {
        const condition = attr.args[0]?.value;
        if (
            condition &&
            AstUtils.streamAst(condition).some(
                (node) => isDataFieldReference(node) && isDataModel(node.$resolvedType?.decl),
            )
        ) {
            accept('error', `\`@@validate\` condition cannot use relation fields`, { node: condition });
        }
    }

    @check('@@id')
    @check('@@index')
    @check('@@unique')
    private _checkConstraint(attr: AttributeApplication, accept: ValidationAcceptor) {
        const fields = attr.args[0]?.value;
        const attrName = attr.decl.ref?.name;
        if (!fields) {
            accept('error', `expects an array of field references`, {
                node: attr.args[0]!,
            });
            return;
        }
        if (isArrayExpr(fields)) {
            if (fields.items.length === 0) {
                accept('error', `\`${attrName}\` expects at least one field reference`, { node: fields });
                return;
            }
            fields.items.forEach((item) => {
                if (!isReferenceExpr(item)) {
                    accept('error', `Expecting a field reference`, {
                        node: item,
                    });
                    return;
                }
                if (!isDataField(item.target.ref)) {
                    accept('error', `Expecting a field reference`, {
                        node: item,
                    });
                    return;
                }

                if (item.target.ref.$container !== attr.$container && isDelegateModel(item.target.ref.$container)) {
                    accept('error', `Cannot use fields inherited from a polymorphic base model in \`${attrName}\``, {
                        node: item,
                    });
                }
            });
        } else {
            accept('error', `Expected an array of field references`, {
                node: fields,
            });
        }
    }

    private validatePolicyKinds(
        kind: string,
        candidates: string[],
        attr: AttributeApplication,
        accept: ValidationAcceptor,
    ) {
        const items = kind.split(',').map((x) => x.trim());
        items.forEach((item) => {
            if (!candidates.includes(item)) {
                accept(
                    'error',
                    `Invalid policy rule kind: "${item}", allowed: ${candidates.map((c) => '"' + c + '"').join(', ')}`,
                    { node: attr },
                );
            }
        });
        return items;
    }
}

function assignableToAttributeParam(arg: AttributeArg, param: AttributeParam, attr: AttributeApplication): boolean {
    const argResolvedType = arg.$resolvedType;
    if (!argResolvedType) {
        return false;
    }

    let dstType = param.type.type;
    let dstIsArray = param.type.array;

    if (dstType === 'ContextType') {
        // ContextType is inferred from the attribute's container's type
        if (isDataField(attr.$container)) {
            // If the field is Typed JSON, and the attribute is @default, the argument must be a string
            const dstIsTypedJson = hasAttribute(attr.$container, '@json');
            if (dstIsTypedJson && attr.decl.ref?.name === '@default') {
                return argResolvedType.decl === 'String';
            }
            dstIsArray = attr.$container.type.array;
        }
    }

    const dstRef = param.type.reference;

    if (dstType === 'Any' && !dstIsArray) {
        return true;
    }

    if (argResolvedType.decl === 'Any') {
        // arg is any type
        if (!argResolvedType.array) {
            // if it's not an array, it's assignable to any type
            return true;
        } else {
            // otherwise it's assignable to any array type
            return argResolvedType.array === dstIsArray;
        }
    }

    // destination is field reference or transitive field reference, check if
    // argument is reference or array or reference
    if (dstType === 'FieldReference' || dstType === 'TransitiveFieldReference') {
        if (dstIsArray) {
            return (
                isArrayExpr(arg.value) &&
                !arg.value.items.find((item) => !isReferenceExpr(item) || !isDataField(item.target.ref))
            );
        } else {
            return isReferenceExpr(arg.value) && isDataField(arg.value.target.ref);
        }
    }

    if (isEnum(argResolvedType.decl)) {
        // enum type

        let attrArgDeclType = dstRef?.ref;
        if (dstType === 'ContextType' && isDataField(attr.$container) && attr.$container?.type?.reference) {
            // attribute parameter type is ContextType, need to infer type from
            // the attribute's container
            attrArgDeclType = resolved(attr.$container.type.reference);
            dstIsArray = attr.$container.type.array;
        }
        return attrArgDeclType === argResolvedType.decl && dstIsArray === argResolvedType.array;
    } else if (dstType) {
        // scalar type

        if (typeof argResolvedType?.decl !== 'string') {
            // destination type is not a reference, so argument type must be a plain expression
            return false;
        }

        if (dstType === 'ContextType') {
            // attribute parameter type is ContextType, need to infer type from
            // the attribute's container
            if (isDataField(attr.$container)) {
                if (!attr.$container?.type?.type) {
                    return false;
                }
                dstType = mapBuiltinTypeToExpressionType(attr.$container.type.type);
                dstIsArray = attr.$container.type.array;
            } else {
                dstType = 'Any';
            }
        }

        return typeAssignable(dstType, argResolvedType.decl, arg.value) && dstIsArray === argResolvedType.array;
    } else {
        // reference type
        return (dstRef?.ref === argResolvedType.decl || dstType === 'Any') && dstIsArray === argResolvedType.array;
    }
}

function isValidAttributeTarget(attrDecl: Attribute, targetDecl: DataField) {
    const targetField = attrDecl.attributes.find((attr) => attr.decl.ref?.name === '@@@targetField');
    if (!targetField?.args[0]) {
        // no field type constraint
        return true;
    }

    const fieldTypes = (targetField.args[0].value as ArrayExpr).items.map(
        (item) => (item as ReferenceExpr).target.ref?.name,
    );

    let allowed = false;
    for (const allowedType of fieldTypes) {
        switch (allowedType) {
            case 'StringField':
                allowed = allowed || targetDecl.type.type === 'String';
                break;
            case 'IntField':
                allowed = allowed || targetDecl.type.type === 'Int';
                break;
            case 'BigIntField':
                allowed = allowed || targetDecl.type.type === 'BigInt';
                break;
            case 'FloatField':
                allowed = allowed || targetDecl.type.type === 'Float';
                break;
            case 'DecimalField':
                allowed = allowed || targetDecl.type.type === 'Decimal';
                break;
            case 'BooleanField':
                allowed = allowed || targetDecl.type.type === 'Boolean';
                break;
            case 'DateTimeField':
                allowed = allowed || targetDecl.type.type === 'DateTime';
                break;
            case 'JsonField':
                allowed = allowed || targetDecl.type.type === 'Json';
                break;
            case 'BytesField':
                allowed = allowed || targetDecl.type.type === 'Bytes';
                break;
            case 'ModelField':
                allowed = allowed || isDataModel(targetDecl.type.reference?.ref);
                break;
            case 'TypeDefField':
                allowed = allowed || isTypeDef(targetDecl.type.reference?.ref);
                break;
            case 'ListField':
                allowed = allowed || (!isDataModel(targetDecl.type.reference?.ref) && targetDecl.type.array);
                break;
            default:
                break;
        }
        if (allowed) {
            break;
        }
    }

    return allowed;
}

export function validateAttributeApplication(
    attr: AttributeApplication,
    accept: ValidationAcceptor,
    contextDataModel?: DataModel,
) {
    new AttributeApplicationValidator().validate(attr, accept, contextDataModel);
}
