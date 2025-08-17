import { invariant } from '@zenstackhq/common-helpers';
import {
    ArrayExpr,
    AttributeArg,
    BinaryExpr,
    DataField,
    DataFieldAttribute,
    DataFieldType,
    DataModel,
    DataModelAttribute,
    Enum,
    Expression,
    InvocationExpr,
    isArrayExpr,
    isBinaryExpr,
    isDataField,
    isDataModel,
    isDataSource,
    isEnum,
    isEnumField,
    isInvocationExpr,
    isLiteralExpr,
    isMemberAccessExpr,
    isNullExpr,
    isProcedure,
    isReferenceExpr,
    isThisExpr,
    isTypeDef,
    isUnaryExpr,
    LiteralExpr,
    MemberAccessExpr,
    Procedure,
    ReferenceExpr,
    TypeDef,
    UnaryExpr,
    type Model,
} from '@zenstackhq/language/ast';
import { getAllAttributes, getAllFields, isDataFieldReference } from '@zenstackhq/language/utils';
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'ts-pattern';
import * as ts from 'typescript';
import { ModelUtils } from '.';
import {
    getAttribute,
    getAuthDecl,
    getIdFields,
    hasAttribute,
    isDelegateModel,
    isIdField,
    isUniqueField,
} from './model-utils';

export class TsSchemaGenerator {
    async generate(model: Model, outputDir: string) {
        fs.mkdirSync(outputDir, { recursive: true });

        // the schema itself
        this.generateSchema(model, outputDir);

        // the model types
        this.generateModelsAndTypeDefs(model, outputDir);

        // the input types
        this.generateInputTypes(model, outputDir);
    }

    private generateSchema(model: Model, outputDir: string) {
        const statements: ts.Statement[] = [];
        this.generateSchemaStatements(model, statements);
        this.generateBannerComments(statements);

        const schemaOutputFile = path.join(outputDir, 'schema.ts');
        const sourceFile = ts.createSourceFile(schemaOutputFile, '', ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        const printer = ts.createPrinter();
        const result = printer.printList(ts.ListFormat.MultiLine, ts.factory.createNodeArray(statements), sourceFile);
        fs.writeFileSync(schemaOutputFile, result);
    }

    private generateSchemaStatements(model: Model, statements: ts.Statement[]) {
        const hasComputedFields = model.declarations.some(
            (d) => isDataModel(d) && d.fields.some((f) => hasAttribute(f, '@computed')),
        );

        const runtimeImportDecl = ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
                false,
                undefined,
                ts.factory.createNamedImports([
                    ts.factory.createImportSpecifier(true, undefined, ts.factory.createIdentifier('SchemaDef')),
                    ...(hasComputedFields
                        ? [
                              ts.factory.createImportSpecifier(
                                  true,
                                  undefined,
                                  ts.factory.createIdentifier('OperandExpression'),
                              ),
                          ]
                        : []),
                    ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier('ExpressionUtils')),
                ]),
            ),
            ts.factory.createStringLiteral('@zenstackhq/runtime/schema'),
        );
        statements.push(runtimeImportDecl);

        const declaration = ts.factory.createVariableStatement(
            [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            ts.factory.createVariableDeclarationList(
                [
                    ts.factory.createVariableDeclaration(
                        'schema',
                        undefined,
                        undefined,
                        ts.factory.createSatisfiesExpression(
                            ts.factory.createAsExpression(
                                this.createSchemaObject(model),
                                ts.factory.createTypeReferenceNode('const'),
                            ),
                            ts.factory.createTypeReferenceNode('SchemaDef'),
                        ),
                    ),
                ],
                ts.NodeFlags.Const,
            ),
        );
        statements.push(declaration);

        // create statement "export type SchemaType = typeof schema;"
        const typeDeclaration = ts.factory.createTypeAliasDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            'SchemaType',
            undefined,
            ts.factory.createTypeReferenceNode('typeof schema'),
        );
        statements.push(typeDeclaration);
    }

    private createSchemaObject(model: Model) {
        const properties: ts.PropertyAssignment[] = [
            // provider
            ts.factory.createPropertyAssignment('provider', this.createProviderObject(model)),

            // models
            ts.factory.createPropertyAssignment('models', this.createModelsObject(model)),

            // typeDefs
            ...(model.declarations.some(isTypeDef)
                ? [ts.factory.createPropertyAssignment('typeDefs', this.createTypeDefsObject(model))]
                : []),
        ];

        // enums
        const enums = model.declarations.filter(isEnum);
        if (enums.length > 0) {
            properties.push(
                ts.factory.createPropertyAssignment(
                    'enums',
                    ts.factory.createObjectLiteralExpression(
                        enums.map((e) => ts.factory.createPropertyAssignment(e.name, this.createEnumObject(e))),
                        true,
                    ),
                ),
            );
        }

        // authType
        const authType = getAuthDecl(model);
        if (authType) {
            properties.push(ts.factory.createPropertyAssignment('authType', this.createLiteralNode(authType.name)));
        }

        // procedures
        const procedures = model.declarations.filter(isProcedure);
        if (procedures.length > 0) {
            properties.push(ts.factory.createPropertyAssignment('procedures', this.createProceduresObject(procedures)));
        }

        // plugins
        properties.push(
            ts.factory.createPropertyAssignment('plugins', ts.factory.createObjectLiteralExpression([], true)),
        );

        return ts.factory.createObjectLiteralExpression(properties, true);
    }

    private createProviderObject(model: Model): ts.Expression {
        const dsProvider = this.getDataSourceProvider(model);
        return ts.factory.createObjectLiteralExpression(
            [ts.factory.createPropertyAssignment('type', ts.factory.createStringLiteral(dsProvider.type))],
            true,
        );
    }

    private createModelsObject(model: Model) {
        return ts.factory.createObjectLiteralExpression(
            model.declarations
                .filter((d): d is DataModel => isDataModel(d) && !hasAttribute(d, '@@ignore'))
                .map((dm) => ts.factory.createPropertyAssignment(dm.name, this.createDataModelObject(dm))),
            true,
        );
    }

    private createTypeDefsObject(model: Model): ts.Expression {
        return ts.factory.createObjectLiteralExpression(
            model.declarations
                .filter((d): d is TypeDef => isTypeDef(d))
                .map((td) => ts.factory.createPropertyAssignment(td.name, this.createTypeDefObject(td))),
            true,
        );
    }

    private createDataModelObject(dm: DataModel) {
        const allFields = getAllFields(dm);
        const allAttributes = getAllAttributes(dm).filter((attr) => {
            // exclude `@@delegate` attribute from base model
            if (attr.decl.$refText === '@@delegate' && attr.$container !== dm) {
                return false;
            }
            return true;
        });
        const subModels = this.getSubModels(dm);

        const fields: ts.PropertyAssignment[] = [
            // name
            ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(dm.name)),

            // baseModel
            ...(dm.baseModel
                ? [
                      ts.factory.createPropertyAssignment(
                          'baseModel',
                          ts.factory.createStringLiteral(dm.baseModel.$refText),
                      ),
                  ]
                : []),

            // fields
            ts.factory.createPropertyAssignment(
                'fields',
                ts.factory.createObjectLiteralExpression(
                    allFields.map((field) =>
                        ts.factory.createPropertyAssignment(field.name, this.createDataFieldObject(field, dm)),
                    ),
                    true,
                ),
            ),

            // attributes
            ...(allAttributes.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'attributes',
                          ts.factory.createArrayLiteralExpression(
                              allAttributes.map((attr) => this.createAttributeObject(attr)),
                              true,
                          ),
                      ),
                  ]
                : []),

            // idFields
            ts.factory.createPropertyAssignment(
                'idFields',
                ts.factory.createArrayLiteralExpression(
                    getIdFields(dm).map((idField) => ts.factory.createStringLiteral(idField)),
                ),
            ),

            // uniqueFields
            ts.factory.createPropertyAssignment('uniqueFields', this.createUniqueFieldsObject(dm)),

            // isDelegate
            ...(isDelegateModel(dm)
                ? [ts.factory.createPropertyAssignment('isDelegate', ts.factory.createTrue())]
                : []),

            // subModels
            ...(subModels.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'subModels',
                          ts.factory.createArrayLiteralExpression(
                              subModels.map((subModel) => ts.factory.createStringLiteral(subModel)),
                          ),
                      ),
                  ]
                : []),
        ];

        const computedFields = dm.fields.filter((f) => hasAttribute(f, '@computed'));

        if (computedFields.length > 0) {
            fields.push(
                ts.factory.createPropertyAssignment('computedFields', this.createComputedFieldsObject(computedFields)),
            );
        }

        return ts.factory.createObjectLiteralExpression(fields, true);
    }

    private getSubModels(dm: DataModel) {
        return dm.$container.declarations
            .filter(isDataModel)
            .filter((d) => d.baseModel?.ref === dm)
            .map((d) => d.name);
    }

    private createTypeDefObject(td: TypeDef): ts.Expression {
        const allFields = getAllFields(td);
        const allAttributes = getAllAttributes(td);

        const fields: ts.PropertyAssignment[] = [
            // name
            ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(td.name)),

            // fields
            ts.factory.createPropertyAssignment(
                'fields',
                ts.factory.createObjectLiteralExpression(
                    allFields.map((field) =>
                        ts.factory.createPropertyAssignment(field.name, this.createDataFieldObject(field, undefined)),
                    ),
                    true,
                ),
            ),

            // attributes
            ...(allAttributes.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'attributes',
                          ts.factory.createArrayLiteralExpression(
                              allAttributes.map((attr) => this.createAttributeObject(attr)),
                              true,
                          ),
                      ),
                  ]
                : []),
        ];

        return ts.factory.createObjectLiteralExpression(fields, true);
    }

    private createComputedFieldsObject(fields: DataField[]) {
        return ts.factory.createObjectLiteralExpression(
            fields.map((field) =>
                ts.factory.createMethodDeclaration(
                    undefined,
                    undefined,
                    field.name,
                    undefined,
                    undefined,
                    [],
                    ts.factory.createTypeReferenceNode('OperandExpression', [
                        ts.factory.createTypeReferenceNode(this.mapFieldTypeToTSType(field.type)),
                    ]),
                    ts.factory.createBlock(
                        [
                            ts.factory.createThrowStatement(
                                ts.factory.createNewExpression(ts.factory.createIdentifier('Error'), undefined, [
                                    ts.factory.createStringLiteral('This is a stub for computed field'),
                                ]),
                            ),
                        ],
                        true,
                    ),
                ),
            ),
            true,
        );
    }

    private mapFieldTypeToTSType(type: DataFieldType) {
        let result = match(type.type)
            .with('String', () => 'string')
            .with('Boolean', () => 'boolean')
            .with('Int', () => 'number')
            .with('Float', () => 'number')
            .with('BigInt', () => 'bigint')
            .with('Decimal', () => 'number')
            .otherwise(() => 'unknown');
        if (type.array) {
            result = `${result}[]`;
        }
        if (type.optional) {
            result = `${result} | null`;
        }
        return result;
    }

    private createDataFieldObject(field: DataField, contextModel: DataModel | undefined) {
        const objectFields = [
            // name
            ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(field.name)),
            // type
            ts.factory.createPropertyAssignment('type', this.generateFieldTypeLiteral(field)),
        ];

        if (contextModel && ModelUtils.isIdField(field, contextModel)) {
            objectFields.push(ts.factory.createPropertyAssignment('id', ts.factory.createTrue()));
        }

        if (isUniqueField(field)) {
            objectFields.push(ts.factory.createPropertyAssignment('unique', ts.factory.createTrue()));
        }

        if (field.type.optional) {
            objectFields.push(ts.factory.createPropertyAssignment('optional', ts.factory.createTrue()));
        }

        if (field.type.array) {
            objectFields.push(ts.factory.createPropertyAssignment('array', ts.factory.createTrue()));
        }

        if (hasAttribute(field, '@updatedAt')) {
            objectFields.push(ts.factory.createPropertyAssignment('updatedAt', ts.factory.createTrue()));
        }

        // originModel
        if (
            contextModel &&
            // id fields are duplicated in inherited models
            !isIdField(field, contextModel) &&
            field.$container !== contextModel &&
            isDelegateModel(field.$container)
        ) {
            // field is inherited from delegate
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'originModel',
                    ts.factory.createStringLiteral(field.$container.name),
                ),
            );
        }

        // discriminator
        if (this.isDiscriminatorField(field)) {
            objectFields.push(ts.factory.createPropertyAssignment('isDiscriminator', ts.factory.createTrue()));
        }

        // attributes
        if (field.attributes.length > 0) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'attributes',
                    ts.factory.createArrayLiteralExpression(
                        field.attributes.map((attr) => this.createAttributeObject(attr)),
                    ),
                ),
            );
        }

        const defaultValue = this.getFieldMappedDefault(field);
        if (defaultValue !== undefined) {
            if (typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
                if ('call' in defaultValue) {
                    objectFields.push(
                        ts.factory.createPropertyAssignment(
                            'default',

                            ts.factory.createCallExpression(
                                ts.factory.createIdentifier('ExpressionUtils.call'),
                                undefined,
                                [
                                    ts.factory.createStringLiteral(defaultValue.call),
                                    ...(defaultValue.args.length > 0
                                        ? [
                                              ts.factory.createArrayLiteralExpression(
                                                  defaultValue.args.map((arg) => this.createLiteralNode(arg)),
                                              ),
                                          ]
                                        : []),
                                ],
                            ),
                        ),
                    );
                } else if ('authMember' in defaultValue) {
                    objectFields.push(
                        ts.factory.createPropertyAssignment(
                            'default',
                            ts.factory.createCallExpression(
                                ts.factory.createIdentifier('ExpressionUtils.member'),
                                undefined,
                                [
                                    ts.factory.createCallExpression(
                                        ts.factory.createIdentifier('ExpressionUtils.call'),
                                        undefined,
                                        [ts.factory.createStringLiteral('auth')],
                                    ),
                                    ts.factory.createArrayLiteralExpression(
                                        defaultValue.authMember.map((m) => ts.factory.createStringLiteral(m)),
                                    ),
                                ],
                            ),
                        ),
                    );
                } else {
                    throw new Error(`Unsupported default value type for field ${field.name}`);
                }
            } else {
                if (Array.isArray(defaultValue)) {
                    objectFields.push(
                        ts.factory.createPropertyAssignment(
                            'default',
                            ts.factory.createArrayLiteralExpression(
                                defaultValue.map((item) => this.createLiteralNode(item as any)),
                            ),
                        ),
                    );
                } else {
                    objectFields.push(
                        ts.factory.createPropertyAssignment('default', this.createLiteralNode(defaultValue)),
                    );
                }
            }
        }

        if (hasAttribute(field, '@computed')) {
            objectFields.push(ts.factory.createPropertyAssignment('computed', ts.factory.createTrue()));
        }

        if (isDataModel(field.type.reference?.ref)) {
            objectFields.push(ts.factory.createPropertyAssignment('relation', this.createRelationObject(field)));
        }

        const fkFor = this.getForeignKeyFor(field);
        if (fkFor && fkFor.length > 0) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'foreignKeyFor',
                    ts.factory.createArrayLiteralExpression(
                        fkFor.map((fk) => ts.factory.createStringLiteral(fk)),
                        true,
                    ),
                ),
            );
        }

        return ts.factory.createObjectLiteralExpression(objectFields, true);
    }

    private isDiscriminatorField(field: DataField) {
        const origin = field.$container;
        return getAttribute(origin, '@@delegate')?.args.some(
            (arg) =>
                arg.$resolvedParam.name === 'discriminator' &&
                isDataFieldReference(arg.value) &&
                arg.value.target.ref === field,
        );
    }

    private getDataSourceProvider(model: Model) {
        const dataSource = model.declarations.find(isDataSource);
        invariant(dataSource, 'No data source found in the model');

        const providerExpr = dataSource.fields.find((f) => f.name === 'provider')?.value;
        invariant(isLiteralExpr(providerExpr), 'Provider must be a literal');
        const type = providerExpr.value as string;
        return { type };
    }

    private getFieldMappedDefault(
        field: DataField,
    ): string | number | boolean | unknown[] | { call: string; args: any[] } | { authMember: string[] } | undefined {
        const defaultAttr = getAttribute(field, '@default');
        if (!defaultAttr) {
            return undefined;
        }
        const defaultValue = defaultAttr.args[0]?.value;
        invariant(defaultValue, 'Expected a default value');
        return this.getMappedValue(defaultValue, field.type);
    }

    private getMappedValue(
        expr: Expression,
        fieldType: DataFieldType,
    ): string | number | boolean | unknown[] | { call: string; args: any[] } | { authMember: string[] } | undefined {
        if (isLiteralExpr(expr)) {
            const lit = (expr as LiteralExpr).value;
            return fieldType.type === 'Boolean'
                ? (lit as boolean)
                : ['Int', 'Float', 'Decimal', 'BigInt'].includes(fieldType.type!)
                  ? Number(lit)
                  : lit;
        } else if (isArrayExpr(expr)) {
            return expr.items.map((item) => this.getMappedValue(item, fieldType));
        } else if (isReferenceExpr(expr) && isEnumField(expr.target.ref)) {
            return expr.target.ref.name;
        } else if (isInvocationExpr(expr)) {
            return {
                call: expr.function.$refText,
                args: expr.args.map((arg) => this.getLiteral(arg.value)),
            };
        } else if (this.isAuthMemberAccess(expr)) {
            return {
                authMember: this.getMemberAccessChain(expr),
            };
        } else {
            throw new Error(`Unsupported default value type for ${expr.$type}`);
        }
    }

    private getMemberAccessChain(expr: MemberAccessExpr): string[] {
        if (!isMemberAccessExpr(expr.operand)) {
            return [expr.member.$refText];
        } else {
            return [...this.getMemberAccessChain(expr.operand), expr.member.$refText];
        }
    }

    private isAuthMemberAccess(expr: Expression): expr is MemberAccessExpr {
        if (isMemberAccessExpr(expr)) {
            return this.isAuthInvocation(expr.operand) || this.isAuthMemberAccess(expr.operand);
        } else {
            return false;
        }
    }

    private isAuthInvocation(expr: Expression) {
        return (
            isInvocationExpr(expr) && expr.function.$refText === 'auth' && ModelUtils.isFromStdlib(expr.function.ref!)
        );
    }

    private createRelationObject(field: DataField) {
        const relationFields: ts.PropertyAssignment[] = [];

        const oppositeRelation = this.getOppositeRelationField(field);
        if (oppositeRelation) {
            relationFields.push(
                ts.factory.createPropertyAssignment('opposite', ts.factory.createStringLiteral(oppositeRelation.name)),
            );
        }

        const relationName = this.getRelationName(field);
        if (relationName) {
            relationFields.push(
                ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(relationName)),
            );
        }

        const relation = getAttribute(field, '@relation');
        if (relation) {
            for (const arg of relation.args) {
                const param = arg.$resolvedParam.name;
                if (param === 'fields' || param === 'references') {
                    const fieldNames = this.getReferenceNames(arg.value);
                    if (fieldNames) {
                        relationFields.push(
                            ts.factory.createPropertyAssignment(
                                param,
                                ts.factory.createArrayLiteralExpression(
                                    fieldNames.map((el) => ts.factory.createStringLiteral(el)),
                                ),
                            ),
                        );
                    }
                }

                if (param === 'onDelete' || param === 'onUpdate') {
                    const action = (arg.value as ReferenceExpr).target.$refText;
                    relationFields.push(
                        ts.factory.createPropertyAssignment(param, ts.factory.createStringLiteral(action)),
                    );
                }
            }
        }

        return ts.factory.createObjectLiteralExpression(relationFields);
    }

    private getReferenceNames(expr: Expression) {
        return isArrayExpr(expr) && expr.items.map((item) => (item as ReferenceExpr).target.$refText);
    }

    private getForeignKeyFor(field: DataField) {
        const result: string[] = [];
        for (const f of field.$container.fields) {
            const relation = getAttribute(f, '@relation');
            if (relation) {
                for (const arg of relation.args) {
                    if (
                        arg.name === 'fields' &&
                        isArrayExpr(arg.value) &&
                        arg.value.items.some((el) => isReferenceExpr(el) && el.target.ref === field)
                    ) {
                        result.push(f.name);
                    }
                }
            }
        }
        return result;
    }

    private getOppositeRelationField(field: DataField) {
        if (!field.type.reference?.ref || !isDataModel(field.type.reference?.ref)) {
            return undefined;
        }

        const sourceModel = field.$container as DataModel;
        const targetModel = field.type.reference.ref as DataModel;
        const relationName = this.getRelationName(field);
        for (const otherField of targetModel.fields) {
            if (otherField === field) {
                // backlink field is never self
                continue;
            }
            if (otherField.type.reference?.ref === sourceModel) {
                if (relationName) {
                    // if relation has a name, the opposite side must match
                    const otherRelationName = this.getRelationName(otherField);
                    if (otherRelationName === relationName) {
                        return otherField;
                    }
                } else {
                    return otherField;
                }
            }
        }
        return undefined;
    }

    private getRelationName(field: DataField) {
        const relation = getAttribute(field, '@relation');
        if (relation) {
            const nameArg = relation.args.find((arg) => arg.$resolvedParam.name === 'name');
            if (nameArg) {
                invariant(isLiteralExpr(nameArg.value), 'name must be a literal');
                return nameArg.value.value as string;
            }
        }
        return undefined;
    }

    private createUniqueFieldsObject(dm: DataModel) {
        const properties: ts.PropertyAssignment[] = [];

        // field-level id and unique
        const allFields = getAllFields(dm);
        for (const field of allFields) {
            if (hasAttribute(field, '@id') || hasAttribute(field, '@unique')) {
                properties.push(
                    ts.factory.createPropertyAssignment(
                        field.name,
                        ts.factory.createObjectLiteralExpression([
                            ts.factory.createPropertyAssignment('type', this.generateFieldTypeLiteral(field)),
                        ]),
                    ),
                );
            }
        }

        // model-level id and unique
        const allAttributes = getAllAttributes(dm);

        // it's possible to have the same set of fields in both `@@id` and `@@unique`
        // so we need to deduplicate them
        const seenKeys = new Set<string>();
        for (const attr of allAttributes) {
            if (attr.decl.$refText === '@@id' || attr.decl.$refText === '@@unique') {
                const fieldNames = this.getReferenceNames(attr.args[0]!.value);
                if (!fieldNames) {
                    continue;
                }

                if (fieldNames.length === 1) {
                    // single-field unique
                    const fieldDef = allFields.find((f) => f.name === fieldNames[0])!;
                    properties.push(
                        ts.factory.createPropertyAssignment(
                            fieldNames[0]!,
                            ts.factory.createObjectLiteralExpression([
                                ts.factory.createPropertyAssignment('type', this.generateFieldTypeLiteral(fieldDef)),
                            ]),
                        ),
                    );
                } else {
                    // multi-field unique
                    const key = fieldNames.join('_');
                    if (seenKeys.has(key)) {
                        continue;
                    }
                    seenKeys.add(key);
                    properties.push(
                        ts.factory.createPropertyAssignment(
                            fieldNames.join('_'),
                            ts.factory.createObjectLiteralExpression(
                                fieldNames.map((field) => {
                                    const fieldDef = allFields.find((f) => f.name === field)!;
                                    return ts.factory.createPropertyAssignment(
                                        field,
                                        ts.factory.createObjectLiteralExpression([
                                            ts.factory.createPropertyAssignment(
                                                'type',
                                                this.generateFieldTypeLiteral(fieldDef),
                                            ),
                                        ]),
                                    );
                                }),
                            ),
                        ),
                    );
                }
            }
        }

        return ts.factory.createObjectLiteralExpression(properties, true);
    }

    private generateFieldTypeLiteral(field: DataField): ts.Expression {
        invariant(
            field.type.type || field.type.reference || field.type.unsupported,
            'Field type must be a primitive, reference, or Unsupported',
        );

        return field.type.type
            ? ts.factory.createStringLiteral(field.type.type)
            : field.type.reference
              ? ts.factory.createStringLiteral(field.type.reference.$refText)
              : // `Unsupported` type
                ts.factory.createStringLiteral('Unsupported');
    }

    private createEnumObject(e: Enum) {
        return ts.factory.createObjectLiteralExpression(
            e.fields.map((field) =>
                ts.factory.createPropertyAssignment(field.name, ts.factory.createStringLiteral(field.name)),
            ),
            true,
        );
    }

    private getLiteral(expr: Expression) {
        if (!isLiteralExpr(expr)) {
            throw new Error('Expected a literal expression');
        }
        switch (expr?.$type) {
            case 'StringLiteral':
            case 'BooleanLiteral':
                return expr.value;
            case 'NumberLiteral':
                return parseFloat(expr.value);
            default:
                throw new Error('Unsupported literal type');
        }
    }

    private createLiteralNode(arg: string | number | boolean | null): any {
        return arg === null
            ? ts.factory.createNull()
            : typeof arg === 'string'
              ? ts.factory.createStringLiteral(arg)
              : typeof arg === 'number'
                ? ts.factory.createNumericLiteral(arg)
                : arg === true
                  ? ts.factory.createTrue()
                  : arg === false
                    ? ts.factory.createFalse()
                    : undefined;
    }

    private createProceduresObject(procedures: Procedure[]) {
        return ts.factory.createObjectLiteralExpression(
            procedures.map((proc) => ts.factory.createPropertyAssignment(proc.name, this.createProcedureObject(proc))),
            true,
        );
    }

    private createProcedureObject(proc: Procedure) {
        const params = ts.factory.createArrayLiteralExpression(
            proc.params.map((param) =>
                ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(param.name)),
                    ...(param.optional
                        ? [ts.factory.createPropertyAssignment('optional', ts.factory.createTrue())]
                        : []),
                    ts.factory.createPropertyAssignment(
                        'type',
                        ts.factory.createStringLiteral(param.type.type ?? param.type.reference!.$refText),
                    ),
                ]),
            ),
            true,
        );

        const paramsType = ts.factory.createTupleTypeNode([
            ...proc.params.map((param) =>
                ts.factory.createNamedTupleMember(
                    undefined,
                    ts.factory.createIdentifier(param.name),
                    undefined,
                    ts.factory.createTypeLiteralNode([
                        ts.factory.createPropertySignature(
                            undefined,
                            ts.factory.createStringLiteral('name'),
                            undefined,
                            ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(param.name)),
                        ),
                        ts.factory.createPropertySignature(
                            undefined,
                            ts.factory.createStringLiteral('type'),
                            undefined,
                            ts.factory.createLiteralTypeNode(
                                ts.factory.createStringLiteral(param.type.type ?? param.type.reference!.$refText),
                            ),
                        ),
                        ...(param.optional
                            ? [
                                  ts.factory.createPropertySignature(
                                      undefined,
                                      ts.factory.createStringLiteral('optional'),
                                      undefined,
                                      ts.factory.createLiteralTypeNode(ts.factory.createTrue()),
                                  ),
                              ]
                            : []),
                    ]),
                ),
            ),
        ]);

        return ts.factory.createObjectLiteralExpression(
            [
                ts.factory.createPropertyAssignment('params', ts.factory.createAsExpression(params, paramsType)),
                ts.factory.createPropertyAssignment(
                    'returnType',
                    ts.factory.createStringLiteral(proc.returnType.type ?? proc.returnType.reference!.$refText),
                ),
                ...(proc.mutation ? [ts.factory.createPropertyAssignment('mutation', ts.factory.createTrue())] : []),
            ],
            true,
        );
    }

    private generateBannerComments(statements: ts.Statement[]) {
        const banner = `////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

/* eslint-disable */

`;
        ts.addSyntheticLeadingComment(statements[0]!, ts.SyntaxKind.SingleLineCommentTrivia, banner);
    }

    private createAttributeObject(attr: DataModelAttribute | DataFieldAttribute): ts.Expression {
        return ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(attr.decl.$refText)),
            ...(attr.args.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'args',
                          ts.factory.createArrayLiteralExpression(attr.args.map((arg) => this.createAttributeArg(arg))),
                      ),
                  ]
                : []),
        ]);
    }

    private createAttributeArg(arg: AttributeArg): ts.Expression {
        return ts.factory.createObjectLiteralExpression([
            // name
            ...(arg.$resolvedParam?.name
                ? [ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(arg.$resolvedParam.name))]
                : []),

            // value
            ts.factory.createPropertyAssignment('value', this.createExpression(arg.value)),
        ]);
    }

    private createExpression(value: Expression): ts.Expression {
        return match(value)
            .when(isLiteralExpr, (expr) => this.createLiteralExpression(expr.$type, expr.value))
            .when(isInvocationExpr, (expr) => this.createCallExpression(expr))
            .when(isReferenceExpr, (expr) => this.createRefExpression(expr))
            .when(isArrayExpr, (expr) => this.createArrayExpression(expr))
            .when(isUnaryExpr, (expr) => this.createUnaryExpression(expr))
            .when(isBinaryExpr, (expr) => this.createBinaryExpression(expr))
            .when(isMemberAccessExpr, (expr) => this.createMemberExpression(expr))
            .when(isNullExpr, () => this.createNullExpression())
            .when(isThisExpr, () => this.createThisExpression())
            .otherwise(() => {
                throw new Error(`Unsupported attribute arg value: ${value.$type}`);
            });
    }

    private createThisExpression() {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils._this'), undefined, []);
    }

    private createMemberExpression(expr: MemberAccessExpr) {
        const members: string[] = [];

        // turn nested member access expression into a flat list of members
        let current: Expression = expr;
        while (isMemberAccessExpr(current)) {
            members.unshift(current.member.$refText);
            current = current.operand;
        }
        const receiver = current;

        const args = [
            this.createExpression(receiver),
            ts.factory.createArrayLiteralExpression(members.map((m) => ts.factory.createStringLiteral(m))),
        ];

        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.member'), undefined, args);
    }

    private createNullExpression() {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils._null'), undefined, []);
    }

    private createBinaryExpression(expr: BinaryExpr) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.binary'), undefined, [
            this.createExpression(expr.left),
            this.createLiteralNode(expr.operator),
            this.createExpression(expr.right),
        ]);
    }

    private createUnaryExpression(expr: UnaryExpr) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.unary'), undefined, [
            this.createLiteralNode(expr.operator),
            this.createExpression(expr.operand),
        ]);
    }

    private createArrayExpression(expr: ArrayExpr): any {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.array'), undefined, [
            ts.factory.createArrayLiteralExpression(expr.items.map((item) => this.createExpression(item))),
        ]);
    }

    private createRefExpression(expr: ReferenceExpr): any {
        if (isDataField(expr.target.ref)) {
            return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.field'), undefined, [
                this.createLiteralNode(expr.target.$refText),
            ]);
        } else if (isEnumField(expr.target.ref)) {
            return this.createLiteralExpression('StringLiteral', expr.target.$refText);
        } else {
            throw new Error(`Unsupported reference type: ${expr.target.$refText}`);
        }
    }

    private createCallExpression(expr: InvocationExpr) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.call'), undefined, [
            ts.factory.createStringLiteral(expr.function.$refText),
            ...(expr.args.length > 0
                ? [ts.factory.createArrayLiteralExpression(expr.args.map((arg) => this.createExpression(arg.value)))]
                : []),
        ]);
    }

    private createLiteralExpression(type: string, value: string | boolean) {
        return match(type)
            .with('BooleanLiteral', () =>
                ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.literal'), undefined, [
                    this.createLiteralNode(value),
                ]),
            )
            .with('NumberLiteral', () =>
                ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.literal'), undefined, [
                    ts.factory.createIdentifier(value as string),
                ]),
            )
            .with('StringLiteral', () =>
                ts.factory.createCallExpression(ts.factory.createIdentifier('ExpressionUtils.literal'), undefined, [
                    this.createLiteralNode(value),
                ]),
            )
            .otherwise(() => {
                throw new Error(`Unsupported literal type: ${type}`);
            });
    }

    private generateModelsAndTypeDefs(model: Model, outputDir: string) {
        const statements: ts.Statement[] = [];

        // generate: import { schema as $schema, type SchemaType as $Schema } from './schema';
        statements.push(this.generateSchemaImport(model, true, true));

        // generate: import type { ModelResult as $ModelResult } from '@zenstackhq/runtime';
        statements.push(
            ts.factory.createImportDeclaration(
                undefined,
                ts.factory.createImportClause(
                    false,
                    undefined,
                    ts.factory.createNamedImports([
                        ts.factory.createImportSpecifier(
                            true,
                            undefined,
                            ts.factory.createIdentifier(`ModelResult as $ModelResult`),
                        ),
                        ...(model.declarations.some(isTypeDef)
                            ? [
                                  ts.factory.createImportSpecifier(
                                      true,
                                      undefined,
                                      ts.factory.createIdentifier(`TypeDefResult as $TypeDefResult`),
                                  ),
                              ]
                            : []),
                    ]),
                ),
                ts.factory.createStringLiteral('@zenstackhq/runtime'),
            ),
        );

        // generate: export type Model = $ModelResult<Schema, 'Model'>;
        const dataModels = model.declarations.filter(isDataModel);
        for (const dm of dataModels) {
            let modelType = ts.factory.createTypeAliasDeclaration(
                [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                dm.name,
                undefined,
                ts.factory.createTypeReferenceNode('$ModelResult', [
                    ts.factory.createTypeReferenceNode('$Schema'),
                    ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(dm.name)),
                ]),
            );
            if (dm.comments.length > 0) {
                modelType = this.generateDocs(modelType, dm);
            }
            statements.push(modelType);
        }

        // generate: export type TypeDef = $TypeDefResult<Schema, 'TypeDef'>;
        const typeDefs = model.declarations.filter(isTypeDef);
        for (const td of typeDefs) {
            let typeDef = ts.factory.createTypeAliasDeclaration(
                [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                td.name,
                undefined,
                ts.factory.createTypeReferenceNode('$TypeDefResult', [
                    ts.factory.createTypeReferenceNode('$Schema'),
                    ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(td.name)),
                ]),
            );
            if (td.comments.length > 0) {
                typeDef = this.generateDocs(typeDef, td);
            }
            statements.push(typeDef);
        }

        // generate: export const Enum = $schema.enums.Enum;
        const enums = model.declarations.filter(isEnum);
        for (const e of enums) {
            let enumDecl = ts.factory.createVariableStatement(
                [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                ts.factory.createVariableDeclarationList(
                    [
                        ts.factory.createVariableDeclaration(
                            e.name,
                            undefined,
                            undefined,
                            ts.factory.createPropertyAccessExpression(
                                ts.factory.createPropertyAccessExpression(
                                    ts.factory.createIdentifier('$schema'),
                                    ts.factory.createIdentifier('enums'),
                                ),
                                ts.factory.createIdentifier(e.name),
                            ),
                        ),
                    ],
                    ts.NodeFlags.Const,
                ),
            );
            if (e.comments.length > 0) {
                enumDecl = this.generateDocs(enumDecl, e);
            }
            statements.push(enumDecl);

            // generate: export type Enum = (typeof Enum)[keyof typeof Enum];
            let typeAlias = ts.factory.createTypeAliasDeclaration(
                [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                e.name,
                undefined,
                ts.factory.createIndexedAccessTypeNode(
                    ts.factory.createTypeQueryNode(ts.factory.createIdentifier(e.name)),
                    ts.factory.createTypeOperatorNode(
                        ts.SyntaxKind.KeyOfKeyword,
                        ts.factory.createTypeQueryNode(ts.factory.createIdentifier(e.name)),
                    ),
                ),
            );
            if (e.comments.length > 0) {
                typeAlias = this.generateDocs(typeAlias, e);
            }
            statements.push(typeAlias);
        }

        this.generateBannerComments(statements);

        // write to file
        const outputFile = path.join(outputDir, 'models.ts');
        const sourceFile = ts.createSourceFile(outputFile, '', ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        const printer = ts.createPrinter();
        const result = printer.printList(ts.ListFormat.MultiLine, ts.factory.createNodeArray(statements), sourceFile);
        fs.writeFileSync(outputFile, result);
    }

    private generateSchemaImport(model: Model, schemaObject: boolean, schemaType: boolean) {
        const importSpecifiers = [];

        if (schemaObject) {
            if (model.declarations.some(isEnum)) {
                // enums require referencing the schema object
                importSpecifiers.push(
                    ts.factory.createImportSpecifier(
                        false,
                        ts.factory.createIdentifier('schema'),
                        ts.factory.createIdentifier('$schema'),
                    ),
                );
            }
        }

        if (schemaType) {
            importSpecifiers.push(
                ts.factory.createImportSpecifier(
                    true,
                    ts.factory.createIdentifier('SchemaType'),
                    ts.factory.createIdentifier('$Schema'),
                ),
            );
        }

        return ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports(importSpecifiers)),
            ts.factory.createStringLiteral('./schema'),
        );
    }

    private generateDocs<T extends ts.TypeAliasDeclaration | ts.VariableStatement>(
        tsDecl: T,
        decl: DataModel | TypeDef | Enum,
    ): T {
        return ts.addSyntheticLeadingComment(
            tsDecl,
            ts.SyntaxKind.MultiLineCommentTrivia,
            `*\n * ${decl.comments.map((c) => c.replace(/^\s*\/*\s*/, '')).join('\n * ')}\n `,
            true,
        );
    }

    private generateInputTypes(model: Model, outputDir: string) {
        const dataModels = model.declarations.filter(isDataModel);
        const statements: ts.Statement[] = [];

        // generate: import { SchemaType as $Schema } from './schema';
        statements.push(this.generateSchemaImport(model, false, true));

        // generate: import { CreateArgs as $CreateArgs, ... } from '@zenstackhq/runtime';
        const inputTypes = [
            'FindManyArgs',
            'FindUniqueArgs',
            'FindFirstArgs',
            'CreateArgs',
            'CreateManyArgs',
            'CreateManyAndReturnArgs',
            'UpdateArgs',
            'UpdateManyArgs',
            'UpdateManyAndReturnArgs',
            'UpsertArgs',
            'DeleteArgs',
            'DeleteManyArgs',
            'CountArgs',
            'AggregateArgs',
            'GroupByArgs',
            'WhereInput',
            'SelectInput',
            'IncludeInput',
            'OmitInput',
        ];

        const inputTypeNameFixes = {
            SelectInput: 'Select',
            IncludeInput: 'Include',
            OmitInput: 'Omit',
        };

        // generate: import { CreateArgs as $CreateArgs, ... } from '@zenstackhq/runtime';
        statements.push(
            ts.factory.createImportDeclaration(
                undefined,
                ts.factory.createImportClause(
                    true,
                    undefined,
                    ts.factory.createNamedImports(
                        inputTypes.map((inputType) =>
                            ts.factory.createImportSpecifier(
                                false,
                                undefined,
                                ts.factory.createIdentifier(`${inputType} as $${inputType}`),
                            ),
                        ),
                    ),
                ),
                ts.factory.createStringLiteral('@zenstackhq/runtime'),
            ),
        );

        // generate: import { type SelectIncludeOmit as $SelectIncludeOmit, type SimplifiedModelResult as $SimplifiedModelResult } from '@zenstackhq/runtime';
        statements.push(
            ts.factory.createImportDeclaration(
                undefined,
                ts.factory.createImportClause(
                    true,
                    undefined,
                    ts.factory.createNamedImports([
                        ts.factory.createImportSpecifier(
                            false,
                            undefined,
                            ts.factory.createIdentifier('SimplifiedModelResult as $SimplifiedModelResult'),
                        ),
                        ts.factory.createImportSpecifier(
                            false,
                            undefined,
                            ts.factory.createIdentifier('SelectIncludeOmit as $SelectIncludeOmit'),
                        ),
                    ]),
                ),
                ts.factory.createStringLiteral('@zenstackhq/runtime'),
            ),
        );

        for (const dm of dataModels) {
            // generate: export type ModelCreateArgs = $CreateArgs<Schema, Model>;
            for (const inputType of inputTypes) {
                const exportName = inputTypeNameFixes[inputType as keyof typeof inputTypeNameFixes]
                    ? `${dm.name}${inputTypeNameFixes[inputType as keyof typeof inputTypeNameFixes]}`
                    : `${dm.name}${inputType}`;
                statements.push(
                    ts.factory.createTypeAliasDeclaration(
                        [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                        exportName,
                        undefined,
                        ts.factory.createTypeReferenceNode(`$${inputType}`, [
                            ts.factory.createTypeReferenceNode('$Schema'),
                            ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(dm.name)),
                        ]),
                    ),
                );
            }

            // generate: export type ModelGetPayload<Args extends $SelectIncludeOmit<Schema, Model, true>> = $SimplifiedModelResult<Schema, Model, Args>;
            statements.push(
                ts.factory.createTypeAliasDeclaration(
                    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                    `${dm.name}GetPayload`,
                    [
                        ts.factory.createTypeParameterDeclaration(
                            undefined,
                            'Args',
                            ts.factory.createTypeReferenceNode('$SelectIncludeOmit', [
                                ts.factory.createTypeReferenceNode('$Schema'),
                                ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(dm.name)),
                                ts.factory.createLiteralTypeNode(ts.factory.createTrue()),
                            ]),
                        ),
                    ],
                    ts.factory.createTypeReferenceNode('$SimplifiedModelResult', [
                        ts.factory.createTypeReferenceNode('$Schema'),
                        ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(dm.name)),
                        ts.factory.createTypeReferenceNode('Args'),
                    ]),
                ),
            );
        }

        this.generateBannerComments(statements);

        // write to file
        const outputFile = path.join(outputDir, 'input.ts');
        const sourceFile = ts.createSourceFile(outputFile, '', ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        const printer = ts.createPrinter();
        const result = printer.printList(ts.ListFormat.MultiLine, ts.factory.createNodeArray(statements), sourceFile);
        fs.writeFileSync(outputFile, result);
    }
}
