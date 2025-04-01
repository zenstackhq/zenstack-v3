import { loadDocument } from '@zenstackhq/language';
import {
    DataModel,
    DataModelField,
    Enum,
    Expression,
    isArrayExpr,
    isDataModel,
    isDataSource,
    isEnum,
    isEnumField,
    isInvocationExpr,
    isLiteralExpr,
    isReferenceExpr,
    LiteralExpr,
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

export async function generate(schemaFile: string, outputFile: string) {
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

    generateSchemaStatements(model, statements);

    generateBannerComments(statements);

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

function generateSchemaStatements(model: Model, statements: ts.Statement[]) {
    const hasComputedFields = model.declarations.some(
        (d) =>
            isDataModel(d) && d.fields.some((f) => hasAttribute(f, '@computed'))
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
                              ts.factory.createIdentifier('OperandExpression')
                          ),
                      ]
                    : []),
            ])
        ),
        ts.factory.createStringLiteral('@zenstackhq/runtime/schema')
    );
    statements.push(runtimeImportDecl);

    const { type: providerType } = getDataSourceProvider(model);
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

    const { type: dsType } = getDataSourceProvider(model);
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
                            createSchemaObject(model),
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

function createSchemaObject(model: Model) {
    const properties: ts.PropertyAssignment[] = [
        // provider
        ts.factory.createPropertyAssignment(
            'provider',
            createProviderObject(model)
        ),

        // models
        ts.factory.createPropertyAssignment(
            'models',
            createModelsObject(model)
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
                            createEnumObject(e)
                        )
                    ),
                    true
                )
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

function createProviderObject(model: Model): ts.Expression {
    const { type, url } = getDataSourceProvider(model);
    return ts.factory.createObjectLiteralExpression(
        [
            ts.factory.createPropertyAssignment(
                'type',
                ts.factory.createStringLiteral(type)
            ),
            ts.factory.createPropertyAssignment(
                'dialectConfigProvider',
                createDialectConfigProvider(type, url)
            ),
        ],
        true
    );
}

function createModelsObject(model: Model) {
    return ts.factory.createObjectLiteralExpression(
        model.declarations
            .filter(isDataModel)
            .map((dm) =>
                ts.factory.createPropertyAssignment(
                    dm.name,
                    createDataModelObject(dm)
                )
            ),
        true
    );
}

function createDataModelObject(dm: DataModel) {
    const fields: ts.PropertyAssignment[] = [
        // table name
        ts.factory.createPropertyAssignment(
            'dbTable',
            ts.factory.createStringLiteral(getTableName(dm))
        ),

        // datamodel fields
        ts.factory.createPropertyAssignment(
            'fields',
            ts.factory.createObjectLiteralExpression(
                dm.fields.map((field) =>
                    ts.factory.createPropertyAssignment(
                        field.name,
                        createDataModelFieldObject(field)
                    )
                ),
                true
            )
        ),

        // idFields
        ts.factory.createPropertyAssignment(
            'idFields',
            ts.factory.createArrayLiteralExpression(
                getIdFields(dm).map((idField) =>
                    ts.factory.createStringLiteral(idField)
                )
            )
        ),

        // uniqueFields
        ts.factory.createPropertyAssignment(
            'uniqueFields',
            createUniqueFieldsObject(dm)
        ),
    ];

    const computedFields = dm.fields.filter((f) =>
        hasAttribute(f, '@computed')
    );

    if (computedFields.length > 0) {
        fields.push(
            ts.factory.createPropertyAssignment(
                'computedFields',
                createComputedFieldsObject(computedFields)
            )
        );
    }

    return ts.factory.createObjectLiteralExpression(fields, true);
}

function createComputedFieldsObject(fields: DataModelField[]) {
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
                        mapTypeToTSSyntaxKeyword(field.type.type!)
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

function mapTypeToTSSyntaxKeyword(type: string) {
    return match<string, ts.KeywordTypeSyntaxKind>(type)
        .with('String', () => ts.SyntaxKind.StringKeyword)
        .with('Boolean', () => ts.SyntaxKind.BooleanKeyword)
        .with('Int', () => ts.SyntaxKind.NumberKeyword)
        .with('Float', () => ts.SyntaxKind.NumberKeyword)
        .with('BigInt', () => ts.SyntaxKind.BigIntKeyword)
        .with('Decimal', () => ts.SyntaxKind.NumberKeyword)
        .otherwise(() => ts.SyntaxKind.UnknownKeyword);
}

function createDataModelFieldObject(field: DataModelField) {
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
            ts.factory.createPropertyAssignment('id', ts.factory.createTrue())
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

    const defaultValue = getMappedDefault(field);
    if (defaultValue) {
        if (typeof defaultValue === 'object' && 'call' in defaultValue) {
            objectFields.push(
                ts.factory.createPropertyAssignment(
                    'default',
                    ts.factory.createObjectLiteralExpression([
                        ts.factory.createPropertyAssignment(
                            'call',
                            ts.factory.createStringLiteral(defaultValue.call)
                        ),
                        ...(defaultValue.args.length > 0
                            ? [
                                  ts.factory.createPropertyAssignment(
                                      'args',
                                      ts.factory.createArrayLiteralExpression(
                                          defaultValue.args.map((arg) =>
                                              createLiteralNode(arg)
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
                createRelationObject(field)
            )
        );
    }

    const fkFor = getForeignKeyFor(field);
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

function getTableName(dm: DataModel) {
    const mapping = dm.attributes.find((attr) => attr.decl.$refText === '@map');
    if (mapping) {
        return (mapping.args[0]?.value as LiteralExpr).value as string;
    } else {
        return dm.name;
    }
}

function getDataSourceProvider(model: Model) {
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
        url = `env(${(urlExpr.args[0]!.value as LiteralExpr).value as string})`;
    } else {
        throw new Error('Unsupported URL type');
    }

    return { type, url };
}

function getMappedDefault(field: DataModelField) {
    const defaultAttr = getAttribute(field, '@default');
    if (!defaultAttr) {
        return undefined;
    }

    const defaultValue = defaultAttr.args[0]?.value;
    if (isLiteralExpr(defaultValue)) {
        const lit = (defaultValue as LiteralExpr).value;
        return field.type.type === 'Boolean'
            ? (lit as boolean)
            : ['Int', 'Float', 'Decimal', 'BigInt'].includes(field.type.type!)
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
            args: defaultValue.args.map((arg) => getLiteral(arg.value)),
        };
    } else {
        throw new Error(
            `Unsupported default value type for field ${field.name}`
        );
    }
}

function createRelationObject(field: DataModelField) {
    const relationFields: ts.PropertyAssignment[] = [];

    const oppositeRelation = getOppositeRelationField(field);
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
                const fieldNames = getReferenceNames(arg.value);
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

function getReferenceNames(expr: Expression) {
    return (
        isArrayExpr(expr) &&
        expr.items.map((item) => (item as ReferenceExpr).target.$refText)
    );
}

function getForeignKeyFor(field: DataModelField) {
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

function getOppositeRelationField(field: DataModelField) {
    if (!field.type.reference?.ref || !isDataModel(field.type.reference?.ref)) {
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

function getIdFields(dm: DataModel) {
    return dm.fields.filter(isIdField).map((f) => f.name);
}

function createUniqueFieldsObject(dm: DataModel) {
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
            const fieldNames = getReferenceNames(attr.args[0]!.value);
            if (!fieldNames) {
                continue;
            }
            properties.push(
                ts.factory.createPropertyAssignment(
                    fieldNames.join('_'),
                    ts.factory.createObjectLiteralExpression(
                        fieldNames.map((field) => {
                            const f = dm.fields.find((f) => f.name === field)!;
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

function createEnumObject(e: Enum) {
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

function getLiteral(expr: Expression) {
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

function createLiteralNode(arg: string | number | boolean): any {
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

function createDialectConfigProvider(type: string, url: string) {
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
                                        ts.factory.createIdentifier('SQLite'),
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
                                        [ts.factory.createStringLiteral(url)]
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

function generateBannerComments(statements: ts.Statement[]) {
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
