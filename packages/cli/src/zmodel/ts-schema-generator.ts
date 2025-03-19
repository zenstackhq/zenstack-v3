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
import * as ts from 'typescript';
import {
    getAttribute,
    hasAttribute,
    isIdField,
    isUniqueField,
} from './model-utils';
import { isEnumField } from '@zenstackhq/language/ast';

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
    const importDecl = ts.factory.createImportDeclaration(
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
            ])
        ),
        ts.factory.createStringLiteral('@zenstackhq/runtime/schema')
    );
    statements.push(importDecl);

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
            ts.factory.createStringLiteral(getDataSourceProvider(model))
        ),

        // models
        ts.factory.createPropertyAssignment(
            'models',
            createModelsObject(model)
        ),
    ];

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

    // authModel
    let authModel = model.declarations.find(
        (d) => isDataModel(d) && hasAttribute(d, '@auth')
    );
    if (!authModel) {
        authModel = model.declarations.find(
            (d) => isDataModel(d) && d.name === 'User'
        );
    }
    if (authModel) {
        properties.push(
            ts.factory.createPropertyAssignment(
                'authModel',
                ts.factory.createStringLiteral(authModel.name)
            )
        );
    }

    return ts.factory.createObjectLiteralExpression(properties, true);
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
    return ts.factory.createObjectLiteralExpression(
        [
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
        ],
        true
    );
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

            const generator = getValueGenerator(
                defaultValue.call,
                defaultValue.args
            );
            if (generator) {
                objectFields.push(
                    ts.factory.createPropertyAssignment(
                        'generator',
                        ts.factory.createStringLiteral(generator)
                    )
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
    const providerExpr = model.declarations
        .find(isDataSource)
        ?.fields?.find((f) => f.name === 'provider')?.value;
    invariant(isLiteralExpr(providerExpr), 'Provider must be a literal');
    return providerExpr.value as string;
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

function getValueGenerator(call: string, args: unknown[]) {
    switch (call) {
        case 'uuid':
            return args[0] === 7 ? 'uuid7' : 'uuid4';
        case 'cuid':
            return args[0] === 2 ? 'cuid2' : 'cuid';
        case 'ulid':
            return 'ulid';
        default:
            return undefined;
    }
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
