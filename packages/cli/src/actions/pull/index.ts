import type { ZModelServices } from '@zenstackhq/language'
import type {
    ArrayExpr,
    AttributeArg,
    DataField,
    DataFieldAttribute,
    DataFieldType,
    DataModel,
    Enum,
    EnumField,
    Model,
    ReferenceExpr,
    StringLiteral,
    UnsupportedFieldType
} from '@zenstackhq/language/ast'
import type { IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider'
import { getAttributeRef, getDbName } from './utils'

export function syncEnums({ dbEnums, model }: { dbEnums: IntrospectedEnum[], model: Model, services: ZModelServices }) {
    for (const dbEnum of dbEnums) {
        const schemaEnum = {
            $type: 'Enum' as const,
            $container: model,
            name: dbEnum.enum_type,
            attributes: [],
            comments: [],
            get fields() {
                return dbEnum.values.map((v): EnumField => ({
                    $type: 'EnumField' as const,
                    $container: schemaEnum,
                    name: v,
                    attributes: [],
                    comments: [],
                }));
            }
        }
        model.declarations.push(schemaEnum)
    }
}

export type Relation = {
    schema: string
    table: string
    column: string
    type: 'one' | 'many'
    fk_name: string
    nullable: boolean
    references: {
        schema: string | null
        table: string | null
        column: string | null
        type: 'one' | 'many'
    }
}

export function syncTable({
    model,
    provider,
    table,
    services
}: {
    table: IntrospectedTable
    model: Model
    provider: IntrospectionProvider
    services: ZModelServices
}) {
    const idAttribute = getAttributeRef('@id', services)
    const uniqueAttribute = getAttributeRef('@unique', services)
    const modelUniqueAttribute = getAttributeRef('@@unique', services)
    const relationAttribute = getAttributeRef('@relation', services)
    const fieldMapAttribute = getAttributeRef('@map', services)
    const tableMapAttribute = getAttributeRef('@@map', services)

    if (!idAttribute || !uniqueAttribute || !relationAttribute || !fieldMapAttribute || !tableMapAttribute) {
        throw new Error('Cannot find required attributes in the model.')
    }

    const relations: Relation[] = []
    const modelTable: DataModel = {
        $type: 'DataModel' as const,
        $container: model,
        name: table.name,
        fields: [],
        attributes: [],
        comments: [],
        isView: false,
        mixins: [],
    }
    model.declarations.push(modelTable)

    modelTable.fields = table.columns.map((col) => {
        if (col.default) console.log(`${table.name}.${col.name} -> ${col.default}`);

        if (col.foreign_key_table) {
            relations.push({
                schema: table.schema,
                table: table.name,
                column: col.name,
                type: 'one',
                fk_name: col.foreign_key_name!,
                nullable: col.nullable,
                references: {
                    schema: col.foreign_key_schema,
                    table: col.foreign_key_table,
                    column: col.foreign_key_column,
                    type: col.unique ? 'one' : 'many',
                },
            })
        }

        const fieldPrefix = /[0-9]/g.test(col.name.charAt(0)) ? '_' : ''
        const fieldName = `${fieldPrefix}${col.name}`

        const builtinType = provider.getBuiltinType(col.datatype)
        const field: DataField = {
            $type: 'DataField' as const,
            get type() {
                return {
                    $container: this,
                    $type: 'DataFieldType' as const,
                    type: builtinType.type === 'Unsupported' ? undefined : builtinType.type,
                    array: builtinType.isArray,
                    get unsupported() {
                        return builtinType.type === 'Unsupported' ? {
                            $container: this,
                            $type: 'UnsupportedFieldType' as const,
                            get value() {
                                return {
                                    $container: this,
                                    $type: 'StringLiteral',
                                    value: col.datatype,
                                } satisfies StringLiteral
                            },
                        } satisfies UnsupportedFieldType : undefined
                    },
                    optional: col.nullable,
                    reference: col.options.length
                        ? {
                            $refText: col.datatype,
                            ref: model.declarations.find(
                                (d) => d.$type === 'Enum' && getDbName(d) === col.datatype
                            ) as Enum | undefined,
                        }
                        : undefined,
                } satisfies DataFieldType
            },
            $container: modelTable!,
            name: fieldName,
            get attributes() {
                if (fieldPrefix !== '') return []

                const getDefaultAttrs = () => {
                    if (!col.default) return [];

                    const defaultValue = col.default && provider.getDefaultValue({
                        fieldName: col.name,
                        defaultValue: col.default,
                        container: this,
                        services,
                        enums: model.declarations.filter((d) => d.$type === 'Enum') as Enum[],
                    })

                    if (!defaultValue) return [];

                    if (Array.isArray(defaultValue)) {
                        return defaultValue;
                    }

                    if (defaultValue?.$type === 'DataFieldAttribute') {
                        return [defaultValue];
                    }

                    return [{
                        $type: 'DataFieldAttribute' as const,
                        $container: this,
                        decl: {
                            $refText: 'default',
                            ref: getAttributeRef('@default', services)
                        },
                        get args() {
                            return [{
                                $type: 'AttributeArg' as const,
                                $container: this,
                                name: '',
                                $resolvedParam: {
                                    name: '',
                                },
                                get value() {
                                    return { ...defaultValue, $container: this }
                                },
                            }] satisfies AttributeArg[]
                        },
                    } satisfies DataFieldAttribute];
                }

                return [
                    ...(col.pk ? [{
                        $type: 'DataFieldAttribute' as const,
                        $container: this,
                        args: [],
                        decl: {
                            $refText: '@id',
                            ref: idAttribute,
                        },
                    }] : []) satisfies DataFieldAttribute[],
                    ...getDefaultAttrs(),
                    {
                        $type: 'DataFieldAttribute' as const,
                        $container: this,
                        decl: {
                            $refText: '@map',
                            ref: fieldMapAttribute,
                        },
                        get args() {
                            return [{
                                $type: 'AttributeArg' as const,
                                $container: this,
                                name: '',
                                $resolvedParam: {
                                    name: '',
                                },
                                get value() {
                                    return {
                                        $type: 'StringLiteral' as const,
                                        $container: this,
                                        value: col.name,
                                    }
                                },
                            }
                            ] satisfies AttributeArg[]
                        },
                    }
                ] satisfies DataFieldAttribute[]
            },
            comments: [],
        }
        return field
    })

    const uniqieColumns = table.columns.filter((c) => c.unique && !c.pk).map((c) => c.name)
    if (uniqieColumns.length > 0) {
        modelTable.attributes.push({
            $type: 'DataModelAttribute' as const,
            $container: modelTable,
            decl: {
                $refText: '@unique',
                ref: modelUniqueAttribute,
            },
            get args() {
                return uniqieColumns.map((c) => ({
                    $type: 'AttributeArg' as const,
                    $container: this,
                    name: '',
                    $resolvedParam: {
                        name: '',
                    },
                    get value() {
                        return {
                            $type: 'ArrayExpr' as const,
                            $container: this,
                            get items() {
                                return [{
                                    $container: this,
                                    $type: 'ReferenceExpr' as const,
                                    target: {
                                        $refText: c,
                                        ref: modelTable.fields.find((f) => f.name === c),
                                    },
                                    args: [],
                                }] satisfies ReferenceExpr[]
                            }
                        } as ArrayExpr
                    },
                })) satisfies AttributeArg[]
            },
        })

        return relations
    }

    return relations
}

export function syncRelation({ model, relation, services }: { model: Model, relation: Relation, services: ZModelServices }) {
    const idAttribute = getAttributeRef('@id', services)
    const uniqueAttribute = getAttributeRef('@unique', services)
    const relationAttribute = getAttributeRef('@relation', services)
    const fieldMapAttribute = getAttributeRef('@map', services)
    const tableMapAttribute = getAttributeRef('@@map', services)

    if (!idAttribute || !uniqueAttribute || !relationAttribute || !fieldMapAttribute || !tableMapAttribute) {
        throw new Error('Cannot find required attributes in the model.')
    }

    const sourceModel = model.declarations.find(
        (d) => d.$type === 'DataModel' && getDbName(d) === relation.table
    ) as DataModel | undefined
    if (!sourceModel) return

    const sourceField = sourceModel.fields.find(
        (f) => getDbName(f) === relation.column
    ) as DataField | undefined
    if (!sourceField) return

    const targetModel = model.declarations.find(
        (d) => d.$type === 'DataModel' && getDbName(d) === relation.references.table
    ) as DataModel | undefined
    if (!targetModel) return

    const targetField = targetModel.fields.find(
        (f) => getDbName(f) === relation.references.column
    )
    if (!targetField) return

    //TODO: Finish relation sync

    const fieldPrefix = /[0-9]/g.test(sourceModel.name.charAt(0)) ? '_' : ''

    sourceModel.fields.push({
        $type: 'DataField' as const,
        $container: sourceModel,
        name: `${fieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`,
        comments: [],
        get type() {
            return {
                $container: this,
                $type: 'DataFieldType' as const,
                reference: {
                    ref: targetModel,
                    $refText: targetModel.name,
                },
                optional: relation.nullable,
                //TODO
                array: relation.type === 'many',
            } satisfies DataFieldType
        },
        get attributes() {
            return [{
                $type: 'DataFieldAttribute' as const,
                $container: this,
                decl: {
                    $refText: '@relation',
                    ref: relationAttribute,
                },
                get args() {
                    return [{
                        $type: 'AttributeArg' as const,
                        $container: this,
                        name: '',
                        $resolvedParam: {
                            name: '',
                        },
                        get value() {
                            return {
                                $type: 'StringLiteral' as const,
                                $container: this,
                                value: relation.fk_name,
                            } satisfies StringLiteral
                        },
                    },
                    {
                        $type: 'AttributeArg' as const,
                        $container: this,
                        name: 'fields',
                        $resolvedParam: {
                            name: 'fields',
                        },
                        get value() {
                            return {
                                $type: 'ArrayExpr' as const,
                                $container: this,
                                get items() {
                                    return [{
                                        $container: this,
                                        $type: 'ReferenceExpr' as const,
                                        target: {
                                            ref: sourceField,
                                            $refText: sourceField.name,
                                        },
                                        args: [],
                                    }] satisfies ReferenceExpr[]
                                },
                            } satisfies ArrayExpr
                        },
                    }, {
                        $type: 'AttributeArg' as const,
                        $container: this,
                        name: 'references',
                        $resolvedParam: {
                            name: 'references',
                        },
                        get value() {
                            return {
                                $type: 'ArrayExpr' as const,
                                $container: this,
                                get items() {
                                    return [{
                                        $container: this,
                                        $type: 'ReferenceExpr' as const,
                                        target: {
                                            ref: targetField,
                                            $refText: targetField.name,
                                        },
                                        args: [],
                                    }] satisfies ReferenceExpr[]
                                },
                            } satisfies ArrayExpr
                        },
                    }, {
                        $type: 'AttributeArg' as const,
                        $container: this,
                        name: 'map',
                        $resolvedParam: {
                            name: 'map',
                        },
                        get value() {
                            return {
                                $type: 'StringLiteral' as const,
                                $container: this,
                                value: relation.fk_name,
                            } satisfies StringLiteral
                        },
                    }] satisfies AttributeArg[]
                },
            }] satisfies DataFieldAttribute[]
        },
    })

    const oppositeFieldPrefix = /[0-9]/g.test(targetModel.name.charAt(0)) ? '_' : ''
    const oppositeFieldName = relation.type === 'one'
        ? `${oppositeFieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}s`
        : `${oppositeFieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`

    targetModel.fields.push({
        $type: 'DataField' as const,
        $container: targetModel,
        name: oppositeFieldName,
        get type() {
            return {
                $container: this,
                $type: 'DataFieldType' as const,
                reference: {
                    ref: sourceModel,
                    $refText: sourceModel.name,
                },
                optional: relation.references.type === 'one' && relation.nullable,
                array: relation.references.type === 'many',
            } satisfies DataFieldType
        },
        get attributes() {
            return [
                {
                    $type: 'DataFieldAttribute' as const,
                    $container: this,
                    decl: {
                        $refText: '@relation',
                        ref: relationAttribute,
                    },
                    get args() {
                        return [{
                            $type: 'AttributeArg' as const,
                            $container: this,
                            name: '',
                            $resolvedParam: {
                                name: '',
                            },
                            get value() {
                                return {
                                    $type: 'StringLiteral' as const,
                                    $container: this,
                                    value: relation.fk_name,
                                } satisfies StringLiteral
                            },
                        }] satisfies AttributeArg[]
                    }
                }
            ] satisfies DataFieldAttribute[]
        },
        comments: [],
    })
}