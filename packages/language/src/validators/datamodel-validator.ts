import { AstUtils, type AstNode, type DiagnosticInfo, type ValidationAcceptor } from 'langium';
import { IssueCodes, SCALAR_TYPES } from '../constants';
import {
    ArrayExpr,
    DataModel,
    DataModelField,
    Model,
    ReferenceExpr,
    isDataModel,
    isDataSource,
    isEnum,
    isModel,
    isStringLiteral,
    isTypeDef,
} from '../generated/ast';
import {
    findUpInheritance,
    getLiteral,
    getModelFieldsWithBases,
    getModelIdFields,
    getModelUniqueFields,
    getUniqueFields,
    hasAttribute,
    isDelegateModel,
} from '../utils';
import { validateAttributeApplication } from './attribute-application-validator';
import { validateDuplicatedDeclarations, type AstValidator } from './common';

/**
 * Validates data model declarations.
 */
export default class DataModelValidator implements AstValidator<DataModel> {
    validate(dm: DataModel, accept: ValidationAcceptor): void {
        this.validateBaseAbstractModel(dm, accept);
        this.validateBaseDelegateModel(dm, accept);
        validateDuplicatedDeclarations(dm, getModelFieldsWithBases(dm), accept);
        this.validateAttributes(dm, accept);
        this.validateFields(dm, accept);

        if (dm.superTypes.length > 0) {
            this.validateInheritance(dm, accept);
        }
    }

    private validateFields(dm: DataModel, accept: ValidationAcceptor) {
        const allFields = getModelFieldsWithBases(dm);
        const idFields = allFields.filter((f) => f.attributes.find((attr) => attr.decl.ref?.name === '@id'));
        const uniqueFields = allFields.filter((f) => f.attributes.find((attr) => attr.decl.ref?.name === '@unique'));
        const modelLevelIds = getModelIdFields(dm);
        const modelUniqueFields = getModelUniqueFields(dm);

        if (
            !dm.isAbstract &&
            idFields.length === 0 &&
            modelLevelIds.length === 0 &&
            uniqueFields.length === 0 &&
            modelUniqueFields.length === 0
        ) {
            accept(
                'error',
                'Model must have at least one unique criteria. Either mark a single field with `@id`, `@unique` or add a multi field criterion with `@@id([])` or `@@unique([])` to the model.',
                {
                    node: dm,
                },
            );
        } else if (idFields.length > 0 && modelLevelIds.length > 0) {
            accept('error', 'Model cannot have both field-level @id and model-level @@id attributes', {
                node: dm,
            });
        } else if (idFields.length > 1) {
            accept('error', 'Model can include at most one field with @id attribute', {
                node: dm,
            });
        } else {
            const fieldsToCheck = idFields.length > 0 ? idFields : modelLevelIds;
            fieldsToCheck.forEach((idField) => {
                if (idField.type.optional) {
                    accept('error', 'Field with @id attribute must not be optional', { node: idField });
                }

                const isArray = idField.type.array;
                const isScalar = SCALAR_TYPES.includes(idField.type.type as (typeof SCALAR_TYPES)[number]);
                const isValidType = isScalar || isEnum(idField.type.reference?.ref);

                if (isArray || !isValidType) {
                    accept('error', 'Field with @id attribute must be of scalar or enum type', { node: idField });
                }
            });
        }

        dm.fields.forEach((field) => this.validateField(field, accept));

        if (!dm.isAbstract) {
            allFields
                .filter((x) => isDataModel(x.type.reference?.ref))
                .forEach((y) => {
                    this.validateRelationField(dm, y, accept);
                });
        }
    }

    private validateField(field: DataModelField, accept: ValidationAcceptor): void {
        if (field.type.array && field.type.optional) {
            accept('error', 'Optional lists are not supported. Use either `Type[]` or `Type?`', { node: field.type });
        }

        if (field.type.unsupported && !isStringLiteral(field.type.unsupported.value)) {
            accept('error', 'Unsupported type argument must be a string literal', { node: field.type.unsupported });
        }

        if (field.type.array && !isDataModel(field.type.reference?.ref)) {
            const provider = this.getDataSourceProvider(AstUtils.getContainerOfType(field, isModel)!);
            if (provider === 'sqlite') {
                accept('error', `Array type is not supported for "${provider}" provider.`, { node: field.type });
            }
        }

        field.attributes.forEach((attr) => validateAttributeApplication(attr, accept));

        if (isTypeDef(field.type.reference?.ref)) {
            if (!hasAttribute(field, '@json')) {
                accept('error', 'Custom-typed field must have @json attribute', { node: field });
            }
        }
    }

    private getDataSourceProvider(model: Model) {
        const dataSource = model.declarations.find(isDataSource);
        if (!dataSource) {
            return undefined;
        }
        const provider = dataSource?.fields.find((f) => f.name === 'provider');
        if (!provider) {
            return undefined;
        }
        return getLiteral<string>(provider.value);
    }

    private validateAttributes(dm: DataModel, accept: ValidationAcceptor) {
        dm.attributes.forEach((attr) => validateAttributeApplication(attr, accept));
    }

    private parseRelation(field: DataModelField, accept?: ValidationAcceptor) {
        const relAttr = field.attributes.find((attr) => attr.decl.ref?.name === '@relation');

        let name: string | undefined;
        let fields: ReferenceExpr[] | undefined;
        let references: ReferenceExpr[] | undefined;
        let valid = true;

        if (!relAttr) {
            return { attr: relAttr, name, fields, references, valid: true };
        }

        for (const arg of relAttr.args) {
            if (!arg.name || arg.name === 'name') {
                if (isStringLiteral(arg.value)) {
                    name = arg.value.value as string;
                }
            } else if (arg.name === 'fields') {
                fields = (arg.value as ArrayExpr).items as ReferenceExpr[];
                if (fields.length === 0) {
                    if (accept) {
                        accept('error', `"fields" value cannot be empty`, {
                            node: arg,
                        });
                    }
                    valid = false;
                }
            } else if (arg.name === 'references') {
                references = (arg.value as ArrayExpr).items as ReferenceExpr[];
                if (references.length === 0) {
                    if (accept) {
                        accept('error', `"references" value cannot be empty`, {
                            node: arg,
                        });
                    }
                    valid = false;
                }
            }
        }

        if (!fields && !references) {
            return { attr: relAttr, name, fields, references, valid: true };
        }

        if (!fields || !references) {
            if (accept) {
                accept('error', `"fields" and "references" must be provided together`, { node: relAttr });
            }
        } else {
            // validate "fields" and "references" typing consistency
            if (fields.length !== references.length) {
                if (accept) {
                    accept('error', `"references" and "fields" must have the same length`, { node: relAttr });
                }
            } else {
                for (let i = 0; i < fields.length; i++) {
                    const fieldRef = fields[i];
                    if (!fieldRef) {
                        continue;
                    }

                    if (!field.type.optional && fieldRef.$resolvedType?.nullable) {
                        // if relation is not optional, then fk field must not be nullable
                        if (accept) {
                            accept(
                                'error',
                                `relation "${field.name}" is not optional, but field "${fieldRef.target.$refText}" is optional`,
                                { node: fieldRef.target.ref! },
                            );
                        }
                    }

                    if (!fieldRef.$resolvedType) {
                        if (accept) {
                            accept('error', `field reference is unresolved`, {
                                node: fieldRef,
                            });
                        }
                    }
                    if (!references[i]?.$resolvedType) {
                        if (accept) {
                            accept('error', `field reference is unresolved`, {
                                node: references[i]!,
                            });
                        }
                    }

                    if (
                        fieldRef.$resolvedType?.decl !== references[i]?.$resolvedType?.decl ||
                        fieldRef.$resolvedType?.array !== references[i]?.$resolvedType?.array
                    ) {
                        if (accept) {
                            accept('error', `values of "references" and "fields" must have the same type`, {
                                node: relAttr,
                            });
                        }
                    }
                }
            }
        }

        return { attr: relAttr, name, fields, references, valid };
    }

    private isSelfRelation(field: DataModelField) {
        return field.type.reference?.ref === field.$container;
    }

    private validateRelationField(contextModel: DataModel, field: DataModelField, accept: ValidationAcceptor) {
        const thisRelation = this.parseRelation(field, accept);
        if (!thisRelation.valid) {
            return;
        }

        if (this.isFieldInheritedFromDelegateModel(field, contextModel)) {
            // relation fields inherited from delegate model don't need opposite relation
            return;
        }

        const oppositeModel = field.type.reference!.ref! as DataModel;

        // Use name because the current document might be updated
        let oppositeFields = getModelFieldsWithBases(oppositeModel, false).filter(
            (f) => f.type.reference?.ref?.name === contextModel.name,
        );
        oppositeFields = oppositeFields.filter((f) => {
            const fieldRel = this.parseRelation(f);
            return fieldRel.valid && fieldRel.name === thisRelation.name;
        });

        if (oppositeFields.length === 0) {
            const info: DiagnosticInfo<AstNode, string> = {
                node: field,
                code: IssueCodes.MissingOppositeRelation,
            };

            info.property = 'name';
            const container = field.$container;

            const relationFieldDocUri = AstUtils.getDocument(container).textDocument.uri;
            const relationDataModelName = container.name;

            const data: MissingOppositeRelationData = {
                relationFieldName: field.name,
                relationDataModelName,
                relationFieldDocUri,
                dataModelName: contextModel.name,
            };

            info.data = data;

            accept(
                'error',
                `The relation field "${field.name}" on model "${contextModel.name}" is missing an opposite relation field on model "${oppositeModel.name}"`,
                info,
            );
            return;
        } else if (oppositeFields.length > 1) {
            oppositeFields
                .filter((f) => f.$container !== contextModel)
                .forEach((f) => {
                    if (this.isSelfRelation(f)) {
                        // self relations are partial
                        // https://www.prisma.io/docs/concepts/components/prisma-schema/relations/self-relations
                    } else {
                        accept(
                            'error',
                            `Fields ${oppositeFields.map((f) => '"' + f.name + '"').join(', ')} on model "${
                                oppositeModel.name
                            }" refer to the same relation to model "${field.$container.name}"`,
                            { node: f },
                        );
                    }
                });
            return;
        }

        const oppositeField = oppositeFields[0]!;
        const oppositeRelation = this.parseRelation(oppositeField);

        let relationOwner: DataModelField;

        if (thisRelation?.references?.length && thisRelation.fields?.length) {
            if (oppositeRelation?.references || oppositeRelation?.fields) {
                accept('error', '"fields" and "references" must be provided only on one side of relation field', {
                    node: oppositeField,
                });
                return;
            } else {
                relationOwner = oppositeField;
            }
        } else if (oppositeRelation?.references?.length && oppositeRelation.fields?.length) {
            if (thisRelation?.references || thisRelation?.fields) {
                accept('error', '"fields" and "references" must be provided only on one side of relation field', {
                    node: field,
                });
                return;
            } else {
                relationOwner = field;
            }
        } else {
            // if both the field is array, then it's an implicit many-to-many relation
            if (!(field.type.array && oppositeField.type.array)) {
                [field, oppositeField].forEach((f) => {
                    if (!this.isSelfRelation(f)) {
                        accept(
                            'error',
                            'Field for one side of relation must carry @relation attribute with both "fields" and "references"',
                            { node: f },
                        );
                    }
                });
            }
            return;
        }

        if (!relationOwner.type.array && !relationOwner.type.optional) {
            accept('error', 'Relation field needs to be list or optional', {
                node: relationOwner,
            });
            return;
        }

        if (relationOwner !== field && !relationOwner.type.array) {
            // one-to-one relation requires defining side's reference field to be @unique
            // e.g.:
            //     model User {
            //         id String @id @default(cuid())
            //         data UserData?
            //     }
            //     model UserData {
            //         id String @id @default(cuid())
            //         user User  @relation(fields: [userId], references: [id])
            //         userId String
            //     }
            //
            // UserData.userId field needs to be @unique

            const containingModel = field.$container as DataModel;
            const uniqueFieldList = getUniqueFields(containingModel);

            // field is defined in the abstract base model
            if (containingModel !== contextModel) {
                uniqueFieldList.push(...getUniqueFields(contextModel));
            }

            thisRelation.fields?.forEach((ref) => {
                const refField = ref.target.ref as DataModelField;
                if (refField) {
                    if (refField.attributes.find((a) => a.decl.ref?.name === '@id' || a.decl.ref?.name === '@unique')) {
                        return;
                    }
                    if (uniqueFieldList.some((list) => list.includes(refField))) {
                        return;
                    }
                    accept(
                        'error',
                        `Field "${refField.name}" on model "${containingModel.name}" is part of a one-to-one relation and must be marked as @unique or be part of a model-level @@unique attribute`,
                        { node: refField },
                    );
                }
            });
        }
    }

    // checks if the given field is inherited directly or indirectly from a delegate model
    private isFieldInheritedFromDelegateModel(field: DataModelField, contextModel: DataModel) {
        const basePath = findUpInheritance(contextModel, field.$container as DataModel);
        if (basePath && basePath.some(isDelegateModel)) {
            return true;
        } else {
            return false;
        }
    }

    private validateBaseAbstractModel(model: DataModel, accept: ValidationAcceptor) {
        model.superTypes.forEach((superType, index) => {
            if (
                !superType.ref?.isAbstract &&
                !superType.ref?.attributes.some((attr) => attr.decl.ref?.name === '@@delegate')
            )
                accept(
                    'error',
                    `Model ${superType.$refText} cannot be extended because it's neither abstract nor marked as "@@delegate"`,
                    {
                        node: model,
                        property: 'superTypes',
                        index,
                    },
                );
        });
    }

    private validateBaseDelegateModel(model: DataModel, accept: ValidationAcceptor) {
        if (model.superTypes.filter((base) => base.ref && isDelegateModel(base.ref)).length > 1) {
            accept('error', 'Extending from multiple delegate models is not supported', {
                node: model,
                property: 'superTypes',
            });
        }
    }

    private validateInheritance(dm: DataModel, accept: ValidationAcceptor) {
        const seen = [dm];
        const todo: DataModel[] = dm.superTypes.map((superType) => superType.ref!);
        while (todo.length > 0) {
            const current = todo.shift()!;
            if (seen.includes(current)) {
                accept(
                    'error',
                    `Circular inheritance detected: ${seen.map((m) => m.name).join(' -> ')} -> ${current.name}`,
                    {
                        node: dm,
                    },
                );
                return;
            }
            seen.push(current);
            todo.push(...current.superTypes.map((superType) => superType.ref!));
        }
    }
}

export interface MissingOppositeRelationData {
    relationDataModelName: string;
    relationFieldName: string;
    // it might be the abstract model in the imported document
    relationFieldDocUri: string;

    // the name of DataModel that the relation field belongs to.
    // the document is the same with the error node.
    dataModelName: string;
}
