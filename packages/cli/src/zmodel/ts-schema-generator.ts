import { loadDocument } from '@zenstackhq/language';
import {
    ArrayExpr,
    AttributeArg,
    DataModel,
    DataModelAttribute,
    DataModelField,
    DataModelFieldAttribute,
    Enum,
    Expression,
    InvocationExpr,
    isArrayExpr,
    isDataModel,
    isDataSource,
    isEnum,
    isEnumField,
    isInvocationExpr,
    isLiteralExpr,
    isProcedure,
    isReferenceExpr,
    LiteralExpr,
    Procedure,
    ReferenceExpr,
    type Model,
} from '@zenstackhq/language/ast';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import * as ts from 'typescript';
import {
    getAttribute,
    hasAttribute,
    isIdField,
    isUniqueField,
} from './model-utils';

export class TsSchemaGenerator {
    public async generate(schemaFile: string, outputFile: string) {
        const loaded = await loadDocument(schemaFile);
        if (!loaded.success) {
            console.error(colors.red('Error loading schema:'));
            loaded.errors.forEach((error) =>
                console.error(colors.red(`- ${error}`))
            );
            return;
        }

        const { model, warnings } = loaded;
        if (warnings.length > 0) {
            console.warn(colors.yellow('Warnings:'));
            warnings.forEach((warning) =>
                console.warn(colors.yellow(`- ${warning}`))
            );
        }

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
        if (providerType === 'sqlite') {
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
        }

        const { type: dsType } = this.getDataSourceProvider(model);
        const dbImportDecl = ts.factory.createImportDeclaration(
            undefined,
            dsType === 'sqlite'
                ? // `import SQLite from 'better-sqlite3';`
                  ts.factory.createImportClause(
                      false,
                      ts.factory.createIdentifier('SQLite'),
                      undefined
                  )
                : // `import { Pool } from 'pg';`
                  ts.factory.createImportClause(
                      false,
                      undefined,
                      ts.factory.createNamedImports([
                          ts.factory.createImportSpecifier(
                              false,
                              undefined,
                              ts.factory.createIdentifier('Pool')
                          ),
                      ])
                  ),
            ts.factory.createStringLiteral(
                dsType === 'sqlite' ? 'better-sqlite3' : 'pg'
            )
        );
        statements.push(dbImportDecl);

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
        const { type, url } = this.getDataSourceProvider(model);
        return ts.factory.createObjectLiteralExpression(
            [
                ts.factory.createPropertyAssignment(
                    'type',
                    ts.factory.createStringLiteral(type)
                ),
                ts.factory.createPropertyAssignment(
                    'dialectConfigProvider',
                    this.createDialectConfigProvider(type, url)
                ),
            ],
            true
        );
    }

    private createModelsObject(model: Model) {
        return ts.factory.createObjectLiteralExpression(
            model.declarations
                .filter(isDataModel)
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
                    dm.fields.map((field) =>
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
                              )
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
                    field.type.type ?? field.type.reference?.$refText!
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
            if (typeof defaultValue === 'object' && 'call' in defaultValue) {
                objectFields.push(
                    ts.factory.createPropertyAssignment(
                        'default',
                        ts.factory.createObjectLiteralExpression([
                            ts.factory.createPropertyAssignment(
                                'call',
                                ts.factory.createStringLiteral(
                                    defaultValue.call
                                )
                            ),
                            ...(defaultValue.args.length > 0
                                ? [
                                      ts.factory.createPropertyAssignment(
                                          'args',
                                          ts.factory.createArrayLiteralExpression(
                                              defaultValue.args.map((arg) =>
                                                  this.createLiteralNode(arg)
                                              )
                                          )
                                      ),
                                  ]
                                : []),
                        ])
                    )
                );
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

    private getTableName(dm: DataModel) {
        const mapping = dm.attributes.find(
            (attr) => attr.decl.$refText === '@map'
        );
        if (mapping) {
            return (mapping.args[0]?.value as LiteralExpr).value as string;
        } else {
            return dm.name;
        }
    }

    private getDataSourceProvider(model: Model) {
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
        let url: string;
        if (isLiteralExpr(urlExpr)) {
            url = urlExpr.value as string;
        } else if (isInvocationExpr(urlExpr)) {
            invariant(
                urlExpr.function.$refText === 'env',
                'only "env" function is supported'
            );
            invariant(
                urlExpr.args.length === 1,
                'env function must have one argument'
            );
            url = `env(${
                (urlExpr.args[0]!.value as LiteralExpr).value as string
            })`;
        } else {
            throw new Error('Unsupported URL type');
        }

        return { type, url };
    }

    private getMappedDefault(field: DataModelField) {
        const defaultAttr = getAttribute(field, '@default');
        if (!defaultAttr) {
            return undefined;
        }

        const defaultValue = defaultAttr.args[0]?.value;
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
        } else {
            throw new Error(
                `Unsupported default value type for field ${field.name}`
            );
        }
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
                            (el) => isLiteralExpr(el) && el.value === field.name
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

        for (const otherField of targetModel.fields) {
            if (otherField === field) {
                // backlink field is never self
                continue;
            }
            if (otherField.type.reference?.ref === sourceModel) {
                // TODO: named relation
                return otherField;
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
                properties.push(
                    ts.factory.createPropertyAssignment(
                        fieldNames.join('_'),
                        ts.factory.createObjectLiteralExpression(
                            fieldNames.map((field) => {
                                const f = dm.fields.find(
                                    (f) => f.name === field
                                )!;
                                return ts.factory.createPropertyAssignment(
                                    'type',
                                    ts.factory.createStringLiteral(f.type.type!)
                                );
                            })
                        )
                    )
                );
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

    private createLiteralNode(arg: string | number | boolean): any {
        return typeof arg === 'string'
            ? ts.factory.createStringLiteral(arg)
            : typeof arg === 'number'
            ? ts.factory.createNumericLiteral(arg)
            : arg === true
            ? ts.factory.createTrue()
            : arg === false
            ? ts.factory.createFalse()
            : undefined;
    }

    private createDialectConfigProvider(type: string, url: string) {
        return match(type)
            .with('sqlite', () => {
                let dbPath = url;
                let parsedUrl: URL | undefined;
                try {
                    parsedUrl = new URL(url);
                } catch {}

                if (parsedUrl) {
                    if (parsedUrl.protocol !== 'file:') {
                        throw new Error(
                            'Invalid SQLite URL: only file protocol is supported'
                        );
                    }
                    dbPath = url.replace(/^file:/, '');
                }

                return ts.factory.createFunctionExpression(
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    ts.factory.createTypeReferenceNode('any'),
                    ts.factory.createBlock(
                        [
                            ts.factory.createReturnStatement(
                                ts.factory.createObjectLiteralExpression([
                                    ts.factory.createPropertyAssignment(
                                        'database',
                                        ts.factory.createNewExpression(
                                            ts.factory.createIdentifier(
                                                'SQLite'
                                            ),
                                            undefined,
                                            [
                                                ts.factory.createCallExpression(
                                                    ts.factory.createIdentifier(
                                                        'path.resolve'
                                                    ),
                                                    undefined,
                                                    [
                                                        // isomorphic __dirname for CJS and import.meta.url for ESM
                                                        ts.factory
                                                            .createIdentifier(`typeof __dirname !== 'undefined'
        ? __dirname
        : path.dirname(url.fileURLToPath(import.meta.url))`),
                                                        ts.factory.createStringLiteral(
                                                            dbPath
                                                        ),
                                                    ]
                                                ),
                                            ]
                                        )
                                    ),
                                ])
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
                                ts.factory.createObjectLiteralExpression([
                                    ts.factory.createPropertyAssignment(
                                        'database',
                                        ts.factory.createNewExpression(
                                            ts.factory.createIdentifier('Pool'),
                                            undefined,
                                            [
                                                ts.factory.createStringLiteral(
                                                    url
                                                ),
                                            ]
                                        )
                                    ),
                                ])
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
                            param.type.type ?? param.type.reference?.$refText!
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
                                        param.type.reference?.$refText!
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
                            proc.returnType.reference?.$refText!
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
            .otherwise(() => {
                throw new Error(
                    `Unsupported attribute arg value: ${value.$type}`
                );
            });
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
        const target = expr.target.ref!;
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('Expression.ref'),
            undefined,
            [
                ts.factory.createStringLiteral(target.$container.name),
                ts.factory.createStringLiteral(target.name),
            ]
        );
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
