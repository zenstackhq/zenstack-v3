import {
    AttributeArg,
    BooleanLiteral,
    ConfigArrayExpr,
    ConfigExpr,
    ConfigInvocationArg,
    DataModel,
    DataModelAttribute,
    DataModelField,
    DataModelFieldAttribute,
    DataModelFieldType,
    DataSource,
    Enum,
    EnumField,
    Expression,
    GeneratorDecl,
    InvocationExpr,
    isArrayExpr,
    isInvocationExpr,
    isLiteralExpr,
    isModel,
    isNullExpr,
    isReferenceExpr,
    isStringLiteral,
    isTypeDef,
    LiteralExpr,
    Model,
    NumberLiteral,
    StringLiteral,
    type AstNode,
} from '@zenstackhq/language/ast';
import { AstUtils } from 'langium';
import { match, P } from 'ts-pattern';

import {
    hasAttribute,
    isDelegateModel,
    isIdField,
} from '../zmodel/model-utils';
import { ZModelCodeGenerator } from '../zmodel/zmodel-code-generator';
import {
    AttributeArgValue,
    ModelField,
    ModelFieldType,
    AttributeArg as PrismaAttributeArg,
    AttributeArgValue as PrismaAttributeArgValue,
    ContainerDeclaration as PrismaContainerDeclaration,
    Model as PrismaDataModel,
    Enum as PrismaEnum,
    FieldAttribute as PrismaFieldAttribute,
    FieldReference as PrismaFieldReference,
    FieldReferenceArg as PrismaFieldReferenceArg,
    FunctionCall as PrismaFunctionCall,
    FunctionCallArg as PrismaFunctionCallArg,
    PrismaModel,
    ContainerAttribute as PrismaModelAttribute,
    type SimpleField,
} from './prisma-builder';

/**
 * Generates Prisma schema file
 */
export class PrismaSchemaGenerator {
    private readonly PRELUDE = `//////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

`;

    constructor(private readonly zmodel: Model) {}

    async generate() {
        const prisma = new PrismaModel();

        for (const decl of this.zmodel.declarations) {
            switch (decl.$type) {
                case DataSource:
                    this.generateDataSource(prisma, decl as DataSource);
                    break;

                case Enum:
                    this.generateEnum(prisma, decl as Enum);
                    break;

                case DataModel:
                    this.generateModel(prisma, decl as DataModel);
                    break;

                case GeneratorDecl:
                    this.generateGenerator(prisma, decl as GeneratorDecl);
                    break;
            }
        }

        return this.PRELUDE + prisma.toString();
    }

    private generateDataSource(prisma: PrismaModel, dataSource: DataSource) {
        const fields: SimpleField[] = dataSource.fields.map((f) => ({
            name: f.name,
            text: this.configExprToText(f.value),
        }));
        prisma.addDataSource(dataSource.name, fields);
    }

    private configExprToText(expr: ConfigExpr) {
        if (isLiteralExpr(expr)) {
            return this.literalToText(expr);
        } else if (isInvocationExpr(expr)) {
            const fc = this.makeFunctionCall(expr);
            return fc.toString();
        } else {
            return this.configArrayToText(expr);
        }
    }

    private configArrayToText(expr: ConfigArrayExpr) {
        return (
            '[' +
            expr.items
                .map((item) => {
                    if (isLiteralExpr(item)) {
                        return this.literalToText(item);
                    } else {
                        return (
                            item.name +
                            (item.args.length > 0
                                ? '(' +
                                  item.args
                                      .map((arg) =>
                                          this.configInvocationArgToText(arg)
                                      )
                                      .join(', ') +
                                  ')'
                                : '')
                        );
                    }
                })
                .join(', ') +
            ']'
        );
    }

    private configInvocationArgToText(arg: ConfigInvocationArg) {
        return `${arg.name}: ${this.literalToText(arg.value)}`;
    }

    private literalToText(expr: LiteralExpr) {
        return JSON.stringify(expr.value);
    }

    private generateGenerator(prisma: PrismaModel, decl: GeneratorDecl) {
        prisma.addGenerator(
            decl.name,
            decl.fields.map((f) => ({
                name: f.name,
                text: this.configExprToText(f.value),
            }))
        );
    }

    private generateModel(prisma: PrismaModel, decl: DataModel) {
        const model = decl.isView
            ? prisma.addView(decl.name)
            : prisma.addModel(decl.name);
        for (const field of decl.fields) {
            if (hasAttribute(field, '@computed')) {
                continue; // skip computed fields
            }
            // TODO: exclude fields inherited from delegate
            this.generateModelField(model, field);
        }

        for (const attr of decl.attributes.filter((attr) =>
            this.isPrismaAttribute(attr)
        )) {
            this.generateContainerAttribute(model, attr);
        }

        // user defined comments pass-through
        decl.comments.forEach((c) => model.addComment(c));

        // TODO: delegate model handling
        // // physical: generate relation fields on base models linking to concrete models
        // this.generateDelegateRelationForBase(model, decl);

        // TODO: delegate model handling
        // // physical: generate reverse relation fields on concrete models
        // this.generateDelegateRelationForConcrete(model, decl);

        // TODO: delegate model handling
        // // logical: expand relations on other models that reference delegated models to concrete models
        // this.expandPolymorphicRelations(model, decl);

        // TODO: delegate model handling
        // // logical: ensure relations inherited from delegate models
        // this.ensureRelationsInheritedFromDelegate(model, decl);
    }

    private isPrismaAttribute(
        attr: DataModelAttribute | DataModelFieldAttribute
    ) {
        if (!attr.decl.ref) {
            return false;
        }
        return attr.decl.ref.attributes.some(
            (a) => a.decl.ref?.name === '@@@prisma'
        );
    }

    private getUnsupportedFieldType(fieldType: DataModelFieldType) {
        if (fieldType.unsupported) {
            const value = this.getStringLiteral(fieldType.unsupported.value);
            if (value) {
                return `Unsupported("${value}")`;
            } else {
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    private getStringLiteral(node: AstNode | undefined): string | undefined {
        return isStringLiteral(node) ? node.value : undefined;
    }

    private generateModelField(
        model: PrismaDataModel,
        field: DataModelField,
        addToFront = false
    ) {
        let fieldType: string | undefined;

        if (field.type.type) {
            // intrinsic type
            fieldType = field.type.type;
        } else if (field.type.reference?.ref) {
            // model, enum, or type-def
            if (isTypeDef(field.type.reference.ref)) {
                fieldType = 'Json';
            } else {
                fieldType = field.type.reference.ref.name;
            }
        } else {
            // Unsupported type
            const unsupported = this.getUnsupportedFieldType(field.type);
            if (unsupported) {
                fieldType = unsupported;
            }
        }

        if (!fieldType) {
            throw new Error(
                `Field type is not resolved: ${field.$container.name}.${field.name}`
            );
        }

        const isArray =
            // typed-JSON fields should be translated to scalar Json type
            isTypeDef(field.type.reference?.ref) ? false : field.type.array;
        const type = new ModelFieldType(
            fieldType,
            isArray,
            field.type.optional
        );

        const attributes = field.attributes
            .filter((attr) => this.isPrismaAttribute(attr))
            // `@default` with calling functions from plugin is handled outside Prisma
            .filter((attr) => !this.isDefaultWithPluginInvocation(attr))
            .filter(
                (attr) =>
                    // when building physical schema, exclude `@default` for id fields inherited from delegate base
                    !(
                        isIdField(field) &&
                        this.isInheritedFromDelegate(field) &&
                        attr.decl.$refText === '@default'
                    )
            )
            .map((attr) => this.makeFieldAttribute(attr));

        const docs = [...field.comments];
        const result = model.addField(
            field.name,
            type,
            attributes,
            docs,
            addToFront
        );

        // if (
        //     field.attributes.some((attr) =>
        //         this.isDefaultWithPluginInvocation(attr)
        //     )
        // ) {
        //     // field has `@default` from a plugin function call, turn it into a dummy default value, and the
        //     // real default value setting is handled outside Prisma
        //     this.setDummyDefault(result, field);
        // }

        return result;
    }

    private isDefaultWithPluginInvocation(attr: DataModelFieldAttribute) {
        if (attr.decl.ref?.name !== '@default') {
            return false;
        }

        const expr = attr.args[0]?.value;
        if (!expr) {
            return false;
        }

        return AstUtils.streamAst(expr).some(
            (node) =>
                isInvocationExpr(node) && this.isFromPlugin(node.function.ref)
        );
    }

    private isFromPlugin(node: AstNode | undefined) {
        const model = AstUtils.getContainerOfType(node, isModel);
        return (
            !!model &&
            !!model.$document &&
            model.$document.uri.path.endsWith('plugin.zmodel')
        );
    }

    private setDummyDefault(result: ModelField, field: DataModelField) {
        const dummyDefaultValue = match(field.type.type)
            .with('String', () => new AttributeArgValue('String', ''))
            .with(
                P.union('Int', 'BigInt', 'Float', 'Decimal'),
                () => new AttributeArgValue('Number', '0')
            )
            .with('Boolean', () => new AttributeArgValue('Boolean', 'false'))
            .with(
                'DateTime',
                () =>
                    new AttributeArgValue(
                        'FunctionCall',
                        new PrismaFunctionCall('now')
                    )
            )
            .with('Json', () => new AttributeArgValue('String', '{}'))
            .with('Bytes', () => new AttributeArgValue('String', ''))
            .otherwise(() => {
                throw new Error(
                    `Unsupported field type with default value: ${field.type.type}`
                );
            });

        result.attributes.push(
            new PrismaFieldAttribute('@default', [
                new PrismaAttributeArg(undefined, dummyDefaultValue),
            ])
        );
    }

    private isInheritedFromDelegate(field: DataModelField) {
        return field.$inheritedFrom && isDelegateModel(field.$inheritedFrom);
    }

    private makeFieldAttribute(attr: DataModelFieldAttribute) {
        const attrName = attr.decl.ref!.name;
        return new PrismaFieldAttribute(
            attrName,
            attr.args.map((arg) => this.makeAttributeArg(arg))
        );
    }

    private makeAttributeArg(arg: AttributeArg): PrismaAttributeArg {
        return new PrismaAttributeArg(
            arg.name,
            this.makeAttributeArgValue(arg.value)
        );
    }

    private makeAttributeArgValue(node: Expression): PrismaAttributeArgValue {
        if (isLiteralExpr(node)) {
            const argType = match(node.$type)
                .with(StringLiteral, () => 'String' as const)
                .with(NumberLiteral, () => 'Number' as const)
                .with(BooleanLiteral, () => 'Boolean' as const)
                .exhaustive();
            return new PrismaAttributeArgValue(argType, node.value);
        } else if (isArrayExpr(node)) {
            return new PrismaAttributeArgValue(
                'Array',
                new Array(
                    ...node.items.map((item) =>
                        this.makeAttributeArgValue(item)
                    )
                )
            );
        } else if (isReferenceExpr(node)) {
            return new PrismaAttributeArgValue(
                'FieldReference',
                new PrismaFieldReference(
                    node.target.ref!.name,
                    node.args.map(
                        (arg) =>
                            new PrismaFieldReferenceArg(
                                arg.name,
                                this.exprToText(arg.value)
                            )
                    )
                )
            );
        } else if (isInvocationExpr(node)) {
            // invocation
            return new PrismaAttributeArgValue(
                'FunctionCall',
                this.makeFunctionCall(node)
            );
        } else {
            throw Error(
                `Unsupported attribute argument expression type: ${node.$type}`
            );
        }
    }

    private exprToText(expr: Expression) {
        return new ZModelCodeGenerator({ quote: 'double' }).generate(expr);
    }

    makeFunctionCall(node: InvocationExpr): PrismaFunctionCall {
        return new PrismaFunctionCall(
            node.function.ref!.name,
            node.args.map((arg) => {
                const val = match(arg.value)
                    .when(isStringLiteral, (v) => `"${v.value}"`)
                    .when(isLiteralExpr, (v) => v.value.toString())
                    .when(isNullExpr, () => 'null')
                    .otherwise(() => {
                        throw new Error(
                            'Function call argument must be literal or null'
                        );
                    });

                return new PrismaFunctionCallArg(val);
            })
        );
    }

    private generateContainerAttribute(
        container: PrismaContainerDeclaration,
        attr: DataModelAttribute
    ) {
        const attrName = attr.decl.ref!.name;
        container.attributes.push(
            new PrismaModelAttribute(
                attrName,
                attr.args.map((arg) => this.makeAttributeArg(arg))
            )
        );
    }

    private generateEnum(prisma: PrismaModel, decl: Enum) {
        const _enum = prisma.addEnum(decl.name);

        for (const field of decl.fields) {
            this.generateEnumField(_enum, field);
        }

        for (const attr of decl.attributes.filter((attr) =>
            this.isPrismaAttribute(attr)
        )) {
            this.generateContainerAttribute(_enum, attr);
        }

        // user defined comments pass-through
        decl.comments.forEach((c) => _enum.addComment(c));
    }

    private generateEnumField(_enum: PrismaEnum, field: EnumField) {
        const attributes = field.attributes
            .filter((attr) => this.isPrismaAttribute(attr))
            .map((attr) => this.makeFieldAttribute(attr));

        const docs = [...field.comments];
        _enum.addField(field.name, attributes, docs);
    }
}
