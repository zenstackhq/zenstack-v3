import { loadDocument } from '@zenstackhq/language';
import {
    ArrayExpr,
    AttributeArg,
    BinaryExpr,
    DataModel,
    DataModelAttribute,
    DataModelField,
    DataModelFieldAttribute,
    Enum,
    Expression,
    InvocationExpr,
    isArrayExpr,
    isBinaryExpr,
    isDataModel,
    isDataModelField,
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
    isUnaryExpr,
    LiteralExpr,
    MemberAccessExpr,
    Procedure,
    ReferenceExpr,
    UnaryExpr,
    type Model,
} from '@zenstackhq/language/ast';
import fs from 'node:fs';
import path from 'node:path';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import * as ts from 'typescript';
import { ModelUtils } from '.';
import {
    getAttribute,
    getAuthDecl,
    hasAttribute,
    isIdField,
    isUniqueField,
} from './model-utils';

export class TsSchemaGenerator {
    public async generate(
        schemaFile: string,
        pluginModelFiles: string[],
        outputFile: string
    ) {
        const loaded = await loadDocument(schemaFile, pluginModelFiles);
        if (!loaded.success) {
            throw new Error(`Error loading schema:${loaded.errors.join('\n')}`);
        }

        const { model, warnings } = loaded;
        const statements: ts.Statement[] = [];

        this.generateSchemaStatements(model, statements);

        this.generateBannerComments(statements);

        const sourceFile = ts.createSourceFile(
            outputFile,
            '',
            ts.ScriptTarget.ESNext,
            false,
            ts.ScriptKind.TS
        );
        const printer = ts.createPrinter();
        const result = printer.printList(
            ts.ListFormat.MultiLine,
            ts.factory.createNodeArray(statements),
            sourceFile
        );

        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, result);

        return { model, warnings };
    }

    private generateSchemaStatements(model: Model, statements: ts.Statement[]) {
        const hasComputedFields = model.declarations.some(
            (d) =>
                isDataModel(d) &&
                d.fields.some((f) => hasAttribute(f, '@computed'))
        );

        const runtimeImportDecl = ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
                false,
                undefined,
                ts.factory.createNamedImports([
                    ts.factory.createImportSpecifier(
                        true,
                        undefined,
                        ts.factory.createIdentifier('SchemaDef')
                    ),
                    ...(hasComputedFields
                        ? [
                              ts.factory.createImportSpecifier(
                                  true,
                                  undefined,
                                  ts.factory.createIdentifier(
                                      'OperandExpression'
                                  )
                              ),
                          ]
                        : []),
                    ts.factory.createImportSpecifier(
                        false,
                        undefined,
                        ts.factory.createIdentifier('Expression')
                    ),
                ])
            ),
            ts.factory.createStringLiteral('@zenstackhq/runtime/schema')
        );
        statements.push(runtimeImportDecl);

        const { type: providerType } = this.getDataSourceProvider(model);
        switch (providerType) {
            case 'sqlite': {
                // add imports for calculating the path of sqlite database file

                // `import path from 'node:path';`
                const pathImportDecl = ts.factory.createImportDeclaration(
                    undefined,
                    ts.factory.createImportClause(
                        false,
                        ts.factory.createIdentifier('path'),
                        undefined
                    ),
                    ts.factory.createStringLiteral('node:path')
                );
                statements.push(pathImportDecl);

                // `import url from 'node:url';`
                const urlImportDecl = ts.factory.createImportDeclaration(
                    undefined,
                    ts.factory.createImportClause(
                        false,
                        ts.factory.createIdentifier('url'),
                        undefined
                    ),
                    ts.factory.createStringLiteral('node:url')
                );
                statements.push(urlImportDecl);

                // `import { toDialectConfig } from '@zenstackhq/runtime/utils/sqlite-utils';`
                const dialectConfigImportDecl =
                    ts.factory.createImportDeclaration(
                        undefined,
                        ts.factory.createImportClause(
                            false,
                            undefined,
                            ts.factory.createNamedImports([
                                ts.factory.createImportSpecifier(
                                    false,
                                    undefined,
                                    ts.factory.createIdentifier(
                                        'toDialectConfig'
                                    )
                                ),
                            ])
                        ),
                        ts.factory.createStringLiteral(
                            '@zenstackhq/runtime/utils/sqlite-utils'
                        )
                    );
                statements.push(dialectConfigImportDecl);
                break;
            }

            case 'postgresql': {
                // `import { toDialectConfig } from '@zenstackhq/runtime/utils/pg-utils';`
                const dialectConfigImportDecl =
                    ts.factory.createImportDeclaration(
                        undefined,
                        ts.factory.createImportClause(
                            false,
                            undefined,
                            ts.factory.createNamedImports([
                                ts.factory.createImportSpecifier(
                                    false,
                                    undefined,
                                    ts.factory.createIdentifier(
                                        'toDialectConfig'
                                    )
                                ),
                            ])
                        ),
                        ts.factory.createStringLiteral(
                            '@zenstackhq/runtime/utils/pg-utils'
                        )
                    );
                statements.push(dialectConfigImportDecl);
                break;
            }
        }

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
                                ts.factory.createTypeReferenceNode('const')
                            ),
                            ts.factory.createTypeReferenceNode('SchemaDef')
                        )
                    ),
                ],
                ts.NodeFlags.Const
            )
        );
        statements.push(declaration);

        // create statement "export type SchemaType = typeof schema;"
        const typeDeclaration = ts.factory.createTypeAliasDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            'SchemaType',
            undefined,
            ts.factory.createTypeReferenceNode('typeof schema')
        );
        statements.push(typeDeclaration);
    }

    private createSchemaObject(model: Model) {
        const properties: ts.PropertyAssignment[] = [
            // provider
            ts.factory.createPropertyAssignment(
                'provider',
                this.createProviderObject(model)
            ),

            // models
            ts.factory.createPropertyAssignment(
                'models',
                this.createModelsObject(model)
            ),
        ];

        // enums
        const enums = model.declarations.filter(isEnum);
        if (enums.length > 0) {
            properties.push(
                ts.factory.createPropertyAssignment(
                    'enums',
                    ts.factory.createObjectLiteralExpression(
                        enums.map((e) =>
                            ts.factory.createPropertyAssignment(
                                e.name,
                                this.createEnumObject(e)
                            )
                        ),
                        true
                    )
                )
            );
        }

        // authType
        const authType = getAuthDecl(model);
        if (authType) {
            properties.push(
                ts.factory.createPropertyAssignment(
                    'authType',
                    this.createLiteralNode(authType.name)
                )
            );
        }

        // procedures
        const procedures = model.declarations.filter(isProcedure);
        if (procedures.length > 0) {
            properties.push(
                ts.factory.createPropertyAssignment(
                    'procedures',
                    this.createProceduresObject(procedures)
                )
            );
        }

        // plugins
        properties.push(
            ts.factory.createPropertyAssignment(
                'plugins',
                ts.factory.createObjectLiteralExpression([], true)
            )
        );

        return ts.factory.createObjectLiteralExpression(properties, true);
    }

    private createProviderObject(model: Model): ts.Expression {
        const dsProvider = this.getDataSourceProvider(model);
        return ts.factory.createObjectLiteralExpression(
            [
                ts.factory.createPropertyAssignment(
                    'type',
                    ts.factory.createStringLiteral(dsProvider.type)
                ),
                ts.factory.createPropertyAssignment(
                    'dialectConfigProvider',
                    this.createDialectConfigProvider(dsProvider)
                ),
            ],
            true
        );
    }

    private createModelsObject(model: Model) {
        return ts.factory.createObjectLiteralExpression(
            model.declarations
                .filter(
                    (d): d is DataModel =>
                        isDataModel(d) && !hasAttribute(d, '@@ignore')
                )
                .map((dm) =>
                    ts.factory.createPropertyAssignment(
                        dm.name,
                        this.createDataModelObject(dm)
                    )
                ),
            true
        );
    }

    private createDataModelObject(dm: DataModel) {
        const fields: ts.PropertyAssignment[] = [
            // fields
            ts.factory.createPropertyAssignment(
                'fields',
                ts.factory.createObjectLiteralExpression(
                    dm.fields
                        .filter((field) => !hasAttribute(field, '@ignore'))
                        .map((field) =>
                            ts.factory.createPropertyAssignment(
                                field.name,
                                this.createDataModelFieldObject(field)
                            )
                        ),
                    true
                )
            ),

            // attributes
            ...(dm.attributes.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'attributes',
                          ts.factory.createArrayLiteralExpression(
                              dm.attributes.map((attr) =>
                                  this.createAttributeObject(attr)
                              ),
                              true
                          )
                      ),
                  ]
                : []),

            // idFields
            ts.factory.createPropertyAssignment(
                'idFields',
                ts.factory.createArrayLiteralExpression(
                    this.getIdFields(dm).map((idField) =>
                        ts.factory.createStringLiteral(idField)
                    )
                )
            ),

            // uniqueFields
            ts.factory.createPropertyAssignment(
                'uniqueFields',
                this.createUniqueFieldsObject(dm)
            ),
        ];

        const computedFields = dm.fields.filter((f) =>
            hasAttribute(f, '@computed')
        );

        if (computedFields.length > 0) {
            fields.push(
                ts.factory.createPropertyAssignment(
                    'computedFields',
                    this.createComputedFieldsObject(computedFields)
                )
            );
        }

        return ts.factory.createObjectLiteralExpression(fields, true);
    }

    private createComputedFieldsObject(fields: DataModelField[]) {
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
                        ts.factory.createKeywordTypeNode(
                            this.mapTypeToTSSyntaxKeyword(field.type.type!)
                        ),
                    ]),
                    ts.factory.createBlock(
                        [
                            ts.factory.createThrowStatement(
                                ts.factory.createNewExpression(
                                    ts.factory.createIdentifier('Error'),
                                    undefined,
                                    [
                                        ts.factory.createStringLiteral(
                                            'This is a stub for computed field'
                                        ),
                                    ]
                                )
                            ),
                        ],
                        true
                    )
                )
            ),
            true
        );
    }

    private mapTypeToTSSyntaxKeyword(type: string) {
        return match<string, ts.KeywordTypeSyntaxKind>(type)
            .with('String', () => ts.SyntaxKind.StringKeyword)
            .with('Boolean', () => ts.SyntaxKind.BooleanKeyword)
            .with('Int', () => ts.SyntaxKind.NumberKeyword)
            .with('Float', () => ts.SyntaxKind.NumberKeyword)
            .with('BigInt', () => ts.SyntaxKind.BigIntKeyword)
            .with('Decimal', () => ts.SyntaxKind.NumberKeyword)
            .otherwise(() => ts.SyntaxKind.UnknownKeyword);
    }

    private createDataModelFieldObject(field: DataModelField) {
        const objectFields = [
            ts.factory.createPropertyAssignment(
                'type',
                ts.factory.createStringLiteral(
                    field.type.type ?? field.type.reference!.$refText
                )
            ),
        ];

        if (isIdField(field)) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'id',
                    ts.factory.createTrue()
                )
            );
        }

        if (isUniqueField(field)) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'unique',
                    ts.factory.createTrue()
                )
            );
        }

        if (field.type.optional) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'optional',
                    ts.factory.createTrue()
                )
            );
        }

        if (field.type.array) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'array',
                    ts.factory.createTrue()
                )
            );
        }

        if (hasAttribute(field, '@updatedAt')) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'updatedAt',
                    ts.factory.createTrue()
                )
            );
        }

        // attributes
        if (field.attributes.length > 0) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'attributes',
                    ts.factory.createArrayLiteralExpression(
                        field.attributes.map((attr) =>
                            this.createAttributeObject(attr)
                        )
                    )
                )
            );
        }

        const defaultValue = this.getMappedDefault(field);
        if (defaultValue !== undefined) {
            if (typeof defaultValue === 'object') {
                if ('call' in defaultValue) {
                    objectFields.push(
                        ts.factory.createPropertyAssignment(
                            'default',

                            ts.factory.createCallExpression(
                                ts.factory.createIdentifier('Expression.call'),
                                undefined,
                                [
                                    ts.factory.createStringLiteral(
                                        defaultValue.call
                                    ),
                                    ...(defaultValue.args.length > 0
                                        ? [
                                              ts.factory.createArrayLiteralExpression(
                                                  defaultValue.args.map((arg) =>
                                                      this.createLiteralNode(
                                                          arg
                                                      )
                                                  )
                                              ),
                                          ]
                                        : []),
                                ]
                            )
                        )
                    );
                } else if ('authMember' in defaultValue) {
                    objectFields.push(
                        ts.factory.createPropertyAssignment(
                            'default',
                            ts.factory.createCallExpression(
                                ts.factory.createIdentifier(
                                    'Expression.member'
                                ),
                                undefined,
                                [
                                    ts.factory.createCallExpression(
                                        ts.factory.createIdentifier(
                                            'Expression.call'
                                        ),
                                        undefined,
                                        [ts.factory.createStringLiteral('auth')]
                                    ),
                                    ts.factory.createArrayLiteralExpression(
                                        defaultValue.authMember.map((m) =>
                                            ts.factory.createStringLiteral(m)
                                        )
                                    ),
                                ]
                            )
                        )
                    );
                } else {
                    throw new Error(
                        `Unsupported default value type for field ${field.name}`
                    );
                }
            } else {
                objectFields.push(
                    ts.factory.createPropertyAssignment(
                        'default',
                        typeof defaultValue === 'string'
                            ? ts.factory.createStringLiteral(defaultValue)
                            : typeof defaultValue === 'number'
                            ? ts.factory.createNumericLiteral(defaultValue)
                            : defaultValue === true
                            ? ts.factory.createTrue()
                            : ts.factory.createFalse()
                    )
                );
            }
        }

        if (hasAttribute(field, '@computed')) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'computed',
                    ts.factory.createTrue()
                )
            );
        }

        if (isDataModel(field.type.reference?.ref)) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'relation',
                    this.createRelationObject(field)
                )
            );
        }

        const fkFor = this.getForeignKeyFor(field);
        if (fkFor && fkFor.length > 0) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'foreignKeyFor',
                    ts.factory.createArrayLiteralExpression(
                        fkFor.map((fk) => ts.factory.createStringLiteral(fk)),
                        true
                    )
                )
            );
        }

        return ts.factory.createObjectLiteralExpression(objectFields, true);
    }

    private getDataSourceProvider(
        model: Model
    ):
        | { type: string; env: undefined; url: string }
        | { type: string; env: string; url: undefined } {
        const dataSource = model.declarations.find(isDataSource);
        invariant(dataSource, 'No data source found in the model');

        const providerExpr = dataSource.fields.find(
            (f) => f.name === 'provider'
        )?.value;
        invariant(isLiteralExpr(providerExpr), 'Provider must be a literal');
        const type = providerExpr.value as string;

        const urlExpr = dataSource.fields.find((f) => f.name === 'url')?.value;
        invariant(
            isLiteralExpr(urlExpr) || isInvocationExpr(urlExpr),
            'URL must be a literal or env function'
        );

        if (isLiteralExpr(urlExpr)) {
            return { type, url: urlExpr.value as string, env: undefined };
        } else if (isInvocationExpr(urlExpr)) {
            invariant(
                urlExpr.function.$refText === 'env',
                'only "env" function is supported'
            );
            invariant(
                urlExpr.args.length === 1,
                'env function must have one argument'
            );
            return {
                type,
                env: (urlExpr.args[0]!.value as LiteralExpr).value as string,
                url: undefined,
            };
        } else {
            throw new Error('Unsupported URL type');
        }
    }

    private getMappedDefault(
        field: DataModelField
    ):
        | string
        | number
        | boolean
        | { call: string; args: any[] }
        | { authMember: string[] }
        | undefined {
        const defaultAttr = getAttribute(field, '@default');
        if (!defaultAttr) {
            return undefined;
        }

        const defaultValue = defaultAttr.args[0]?.value;
        invariant(defaultValue, 'Expected a default value');

        if (isLiteralExpr(defaultValue)) {
            const lit = (defaultValue as LiteralExpr).value;
            return field.type.type === 'Boolean'
                ? (lit as boolean)
                : ['Int', 'Float', 'Decimal', 'BigInt'].includes(
                      field.type.type!
                  )
                ? Number(lit)
                : lit;
        } else if (
            isReferenceExpr(defaultValue) &&
            isEnumField(defaultValue.target.ref)
        ) {
            return defaultValue.target.ref.name;
        } else if (isInvocationExpr(defaultValue)) {
            return {
                call: defaultValue.function.$refText,
                args: defaultValue.args.map((arg) =>
                    this.getLiteral(arg.value)
                ),
            };
        } else if (this.isAuthMemberAccess(defaultValue)) {
            return {
                authMember: this.getMemberAccessChain(defaultValue),
            };
        } else {
            throw new Error(
                `Unsupported default value type for field ${field.name}`
            );
        }
    }

    private getMemberAccessChain(expr: MemberAccessExpr): string[] {
        if (!isMemberAccessExpr(expr.operand)) {
            return [expr.member.$refText];
        } else {
            return [
                ...this.getMemberAccessChain(expr.operand),
                expr.member.$refText,
            ];
        }
    }

    private isAuthMemberAccess(expr: Expression): expr is MemberAccessExpr {
        if (isMemberAccessExpr(expr)) {
            return (
                this.isAuthInvocation(expr.operand) ||
                this.isAuthMemberAccess(expr.operand)
            );
        } else {
            return false;
        }
    }

    private isAuthInvocation(expr: Expression) {
        return (
            isInvocationExpr(expr) &&
            expr.function.$refText === 'auth' &&
            ModelUtils.isFromStdlib(expr.function.ref!)
        );
    }

    private createRelationObject(field: DataModelField) {
        const relationFields: ts.PropertyAssignment[] = [];

        const oppositeRelation = this.getOppositeRelationField(field);
        if (oppositeRelation) {
            relationFields.push(
                ts.factory.createPropertyAssignment(
                    'opposite',
                    ts.factory.createStringLiteral(oppositeRelation.name)
                )
            );
        }

        const relationName = this.getRelationName(field);
        if (relationName) {
            relationFields.push(
                ts.factory.createPropertyAssignment(
                    'name',
                    ts.factory.createStringLiteral(relationName)
                )
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
                                    fieldNames.map((el) =>
                                        ts.factory.createStringLiteral(el)
                                    )
                                )
                            )
                        );
                    }
                }

                if (param === 'onDelete' || param === 'onUpdate') {
                    const action = (arg.value as ReferenceExpr).target.$refText;
                    relationFields.push(
                        ts.factory.createPropertyAssignment(
                            param,
                            ts.factory.createStringLiteral(action)
                        )
                    );
                }
            }
        }

        return ts.factory.createObjectLiteralExpression(relationFields);
    }

    private getReferenceNames(expr: Expression) {
        return (
            isArrayExpr(expr) &&
            expr.items.map((item) => (item as ReferenceExpr).target.$refText)
        );
    }

    private getForeignKeyFor(field: DataModelField) {
        const result: string[] = [];
        for (const f of field.$container.fields) {
            const relation = getAttribute(f, '@relation');
            if (relation) {
                for (const arg of relation.args) {
                    if (
                        arg.name === 'fields' &&
                        isArrayExpr(arg.value) &&
                        arg.value.items.some(
                            (el) =>
                                isReferenceExpr(el) && el.target.ref === field
                        )
                    ) {
                        result.push(f.name);
                    }
                }
            }
        }
        return result;
    }

    private getOppositeRelationField(field: DataModelField) {
        if (
            !field.type.reference?.ref ||
            !isDataModel(field.type.reference?.ref)
        ) {
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

    private getRelationName(field: DataModelField) {
        const relation = getAttribute(field, '@relation');
        if (relation) {
            const nameArg = relation.args.find(
                (arg) => arg.$resolvedParam.name === 'name'
            );
            if (nameArg) {
                invariant(
                    isLiteralExpr(nameArg.value),
                    'name must be a literal'
                );
                return nameArg.value.value as string;
            }
        }
        return undefined;
    }

    private getIdFields(dm: DataModel) {
        return dm.fields.filter(isIdField).map((f) => f.name);
    }

    private createUniqueFieldsObject(dm: DataModel) {
        const properties: ts.PropertyAssignment[] = [];

        // field-level id and unique
        for (const field of dm.fields) {
            if (hasAttribute(field, '@id') || hasAttribute(field, '@unique')) {
                properties.push(
                    ts.factory.createPropertyAssignment(
                        field.name,
                        ts.factory.createObjectLiteralExpression([
                            ts.factory.createPropertyAssignment(
                                'type',
                                ts.factory.createStringLiteral(field.type.type!)
                            ),
                        ])
                    )
                );
            }
        }

        // model-level id and unique
        for (const attr of dm.attributes) {
            if (
                attr.decl.$refText === '@@id' ||
                attr.decl.$refText === '@@unique'
            ) {
                const fieldNames = this.getReferenceNames(attr.args[0]!.value);
                if (!fieldNames) {
                    continue;
                }

                if (fieldNames.length === 1) {
                    // single-field unique
                    const fieldDef = dm.fields.find(
                        (f) => f.name === fieldNames[0]
                    )!;
                    properties.push(
                        ts.factory.createPropertyAssignment(
                            fieldNames[0]!,
                            ts.factory.createObjectLiteralExpression([
                                ts.factory.createPropertyAssignment(
                                    'type',
                                    ts.factory.createStringLiteral(
                                        fieldDef.type.type!
                                    )
                                ),
                            ])
                        )
                    );
                } else {
                    // multi-field unique
                    properties.push(
                        ts.factory.createPropertyAssignment(
                            fieldNames.join('_'),
                            ts.factory.createObjectLiteralExpression(
                                fieldNames.map((field) => {
                                    const fieldDef = dm.fields.find(
                                        (f) => f.name === field
                                    )!;
                                    return ts.factory.createPropertyAssignment(
                                        field,
                                        ts.factory.createObjectLiteralExpression(
                                            [
                                                ts.factory.createPropertyAssignment(
                                                    'type',
                                                    ts.factory.createStringLiteral(
                                                        fieldDef.type.type!
                                                    )
                                                ),
                                            ]
                                        )
                                    );
                                })
                            )
                        )
                    );
                }
            }
        }

        return ts.factory.createObjectLiteralExpression(properties, true);
    }

    private createEnumObject(e: Enum) {
        return ts.factory.createObjectLiteralExpression(
            e.fields.map((field) =>
                ts.factory.createPropertyAssignment(
                    field.name,
                    ts.factory.createStringLiteral(field.name)
                )
            ),
            true
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

    private createDialectConfigProvider(
        dsProvider:
            | { type: string; env: undefined; url: string }
            | { type: string; env: string; url: undefined }
    ) {
        const type = dsProvider.type;

        let urlExpr: ts.Expression;
        if (dsProvider.env !== undefined) {
            urlExpr = ts.factory.createIdentifier(
                `process.env['${dsProvider.env}']`
            );
        } else {
            urlExpr = ts.factory.createStringLiteral(dsProvider.url);

            if (type === 'sqlite') {
                // convert file: URL to a regular path
                let parsedUrl: URL | undefined;
                try {
                    parsedUrl = new URL(dsProvider.url);
                } catch {
                    // ignore
                }

                if (parsedUrl) {
                    if (parsedUrl.protocol !== 'file:') {
                        throw new Error(
                            'Invalid SQLite URL: only file protocol is supported'
                        );
                    }
                    urlExpr = ts.factory.createStringLiteral(
                        dsProvider.url.replace(/^file:/, '')
                    );
                }
            }
        }

        return match(type)
            .with('sqlite', () => {
                return ts.factory.createFunctionExpression(
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    ts.factory.createBlock(
                        [
                            ts.factory.createReturnStatement(
                                ts.factory.createCallExpression(
                                    ts.factory.createIdentifier(
                                        'toDialectConfig'
                                    ),
                                    undefined,
                                    [
                                        urlExpr,
                                        ts.factory.createIdentifier(
                                            `typeof __dirname !== 'undefined' ? __dirname : path.dirname(url.fileURLToPath(import.meta.url))`
                                        ),
                                    ]
                                )
                            ),
                        ],
                        true
                    )
                );
            })
            .with('postgresql', () => {
                return ts.factory.createFunctionExpression(
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    ts.factory.createBlock(
                        [
                            ts.factory.createReturnStatement(
                                ts.factory.createCallExpression(
                                    ts.factory.createIdentifier(
                                        'toDialectConfig'
                                    ),
                                    undefined,
                                    [urlExpr]
                                )
                            ),
                        ],
                        true
                    )
                );
            })
            .otherwise(() => {
                throw new Error(`Unsupported provider: ${type}`);
            });
    }

    private createProceduresObject(procedures: Procedure[]) {
        return ts.factory.createObjectLiteralExpression(
            procedures.map((proc) =>
                ts.factory.createPropertyAssignment(
                    proc.name,
                    this.createProcedureObject(proc)
                )
            ),
            true
        );
    }

    private createProcedureObject(proc: Procedure) {
        const params = ts.factory.createArrayLiteralExpression(
            proc.params.map((param) =>
                ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment(
                        'name',
                        ts.factory.createStringLiteral(param.name)
                    ),
                    ...(param.optional
                        ? [
                              ts.factory.createPropertyAssignment(
                                  'optional',
                                  ts.factory.createTrue()
                              ),
                          ]
                        : []),
                    ts.factory.createPropertyAssignment(
                        'type',
                        ts.factory.createStringLiteral(
                            param.type.type ?? param.type.reference!.$refText
                        )
                    ),
                ])
            ),
            true
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
                            ts.factory.createLiteralTypeNode(
                                ts.factory.createStringLiteral(param.name)
                            )
                        ),
                        ts.factory.createPropertySignature(
                            undefined,
                            ts.factory.createStringLiteral('type'),
                            undefined,
                            ts.factory.createLiteralTypeNode(
                                ts.factory.createStringLiteral(
                                    param.type.type ??
                                        param.type.reference!.$refText
                                )
                            )
                        ),
                        ...(param.optional
                            ? [
                                  ts.factory.createPropertySignature(
                                      undefined,
                                      ts.factory.createStringLiteral(
                                          'optional'
                                      ),
                                      undefined,
                                      ts.factory.createLiteralTypeNode(
                                          ts.factory.createTrue()
                                      )
                                  ),
                              ]
                            : []),
                    ])
                )
            ),
        ]);

        return ts.factory.createObjectLiteralExpression(
            [
                ts.factory.createPropertyAssignment(
                    'params',
                    ts.factory.createAsExpression(params, paramsType)
                ),
                ts.factory.createPropertyAssignment(
                    'returnType',
                    ts.factory.createStringLiteral(
                        proc.returnType.type ??
                            proc.returnType.reference!.$refText
                    )
                ),
                ...(proc.mutation
                    ? [
                          ts.factory.createPropertyAssignment(
                              'mutation',
                              ts.factory.createTrue()
                          ),
                      ]
                    : []),
            ],
            true
        );
    }

    private generateBannerComments(statements: ts.Statement[]) {
        const banner = `////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

`;
        ts.addSyntheticLeadingComment(
            statements[0]!,
            ts.SyntaxKind.SingleLineCommentTrivia,
            banner
        );
    }

    private createAttributeObject(
        attr: DataModelAttribute | DataModelFieldAttribute
    ): ts.Expression {
        return ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment(
                'name',
                ts.factory.createStringLiteral(attr.decl.$refText)
            ),
            ...(attr.args.length > 0
                ? [
                      ts.factory.createPropertyAssignment(
                          'args',
                          ts.factory.createArrayLiteralExpression(
                              attr.args.map((arg) =>
                                  this.createAttributeArg(arg)
                              )
                          )
                      ),
                  ]
                : []),
        ]);
    }

    private createAttributeArg(arg: AttributeArg): ts.Expression {
        return ts.factory.createObjectLiteralExpression([
            // name
            ...(arg.$resolvedParam?.name
                ? [
                      ts.factory.createPropertyAssignment(
                          'name',
                          ts.factory.createStringLiteral(
                              arg.$resolvedParam.name
                          )
                      ),
                  ]
                : []),

            // value
            ts.factory.createPropertyAssignment(
                'value',
                this.createExpression(arg.value)
            ),
        ]);
    }

    private createExpression(value: Expression): ts.Expression {
        return match(value)
            .when(isLiteralExpr, (expr) =>
                this.createLiteralExpression(expr.$type, expr.value)
            )
            .when(isInvocationExpr, (expr) => this.createCallExpression(expr))
            .when(isReferenceExpr, (expr) => this.createRefExpression(expr))
            .when(isArrayExpr, (expr) => this.createArrayExpression(expr))
            .when(isUnaryExpr, (expr) => this.createUnaryExpression(expr))
            .when(isBinaryExpr, (expr) => this.createBinaryExpression(expr))
            .when(isMemberAccessExpr, (expr) =>
                this.createMemberExpression(expr)
            )
            .when(isNullExpr, () => this.createNullExpression())
            .when(isThisExpr, () => this.createThisExpression())
            .otherwise(() => {
                throw new Error(
                    `Unsupported attribute arg value: ${value.$type}`
                );
            });
    }

    private createThisExpression() {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression._this'),
            undefined,
            []
        );
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
            ts.factory.createArrayLiteralExpression(
                members.map((m) => ts.factory.createStringLiteral(m))
            ),
        ];

        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.member'),
            undefined,
            args
        );
    }

    private createNullExpression() {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression._null'),
            undefined,
            []
        );
    }

    private createBinaryExpression(expr: BinaryExpr) {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.binary'),
            undefined,
            [
                this.createExpression(expr.left),
                this.createLiteralNode(expr.operator),
                this.createExpression(expr.right),
            ]
        );
    }

    private createUnaryExpression(expr: UnaryExpr) {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.unary'),
            undefined,
            [
                this.createLiteralNode(expr.operator),
                this.createExpression(expr.operand),
            ]
        );
    }

    private createArrayExpression(expr: ArrayExpr): any {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.array'),
            undefined,
            [
                ts.factory.createArrayLiteralExpression(
                    expr.items.map((item) => this.createExpression(item))
                ),
            ]
        );
    }

    private createRefExpression(expr: ReferenceExpr): any {
        if (isDataModelField(expr.target.ref)) {
            return ts.factory.createCallExpression(
                ts.factory.createIdentifier('Expression.field'),
                undefined,
                [this.createLiteralNode(expr.target.$refText)]
            );
        } else if (isEnumField(expr.target.ref)) {
            return this.createLiteralExpression(
                'StringLiteral',
                expr.target.$refText
            );
        } else {
            throw new Error(
                `Unsupported reference type: ${expr.target.$refText}`
            );
        }
    }

    private createCallExpression(expr: InvocationExpr) {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.call'),
            undefined,
            [
                ts.factory.createStringLiteral(expr.function.$refText),
                ...(expr.args.length > 0
                    ? [
                          ts.factory.createArrayLiteralExpression(
                              expr.args.map((arg) =>
                                  this.createExpression(arg.value)
                              )
                          ),
                      ]
                    : []),
            ]
        );
    }

    private createLiteralExpression(type: string, value: string | boolean) {
        return match(type)
            .with('BooleanLiteral', () =>
                ts.factory.createCallExpression(
                    ts.factory.createIdentifier('Expression.literal'),
                    undefined,
                    [this.createLiteralNode(value)]
                )
            )
            .with('NumberLiteral', () =>
                ts.factory.createCallExpression(
                    ts.factory.createIdentifier('Expression.literal'),
                    undefined,
                    [ts.factory.createIdentifier(value as string)]
                )
            )
            .with('StringLiteral', () =>
                ts.factory.createCallExpression(
                    ts.factory.createIdentifier('Expression.literal'),
                    undefined,
                    [this.createLiteralNode(value)]
                )
            )
            .otherwise(() => {
                throw new Error(`Unsupported literal type: ${type}`);
            });
    }
}
