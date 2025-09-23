import type { ZModelServices } from '@zenstackhq/language'
import type {
    Attribute,
    AttributeArg,
    DataField,
    DataFieldAttribute,
    DataFieldType,
    DataModel,
    Enum,
    EnumField,
    Model,
    UnsupportedFieldType
} from '@zenstackhq/language/ast'
import type { IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider'
import { getAttributeRef, getDbName } from './utils'

export function syncEnums(dbEnums: IntrospectedEnum[], model: Model) {
    for (const dbEnum of dbEnums) {
        let schemaEnum = model.declarations.find(
            (d) => d.$type === 'Enum' && getDbName(d) === dbEnum.enum_type
        ) as Enum | undefined

        if (!schemaEnum) {
            schemaEnum = {
                $type: 'Enum' as const,
                $container: model,
                name: dbEnum.enum_type,
                attributes: [],
                comments: [],
                fields: [],
            }
            model.declarations.push(schemaEnum)
        }
        schemaEnum.fields = dbEnum.values.map((v) => {
            const existingValue = schemaEnum.fields.find((f) => getDbName(f) === v)
            if (!existingValue) {
                const enumField: EnumField = {
                    $type: 'EnumField' as const,
                    $container: schemaEnum,
                    name: v,
                    attributes: [],
                    comments: [],
                }
                return enumField
            }
            return existingValue
        })
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
    }
}

export function syncTable({
    model,
    provider,
    table,
}: {
    table: IntrospectedTable
    model: Model
    provider: IntrospectionProvider
}) {
    const relations: Relation[] = []
    let modelTable = model.declarations.find(
        (d) => d.$type === 'DataModel' && getDbName(d) === table.name
    ) as DataModel | undefined

    if (!modelTable) {
        modelTable = {
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
    }

    modelTable.fields = table.columns.map((col) => {
        if (col.foreign_key_table) {
            relations.push({
                schema: table.schema,
                table: table.name,
                column: col.name,
                type: col.unique ? 'one' : 'many',
                fk_name: col.foreign_key_name!,
                nullable: col.nullable,
                references: {
                    schema: col.foreign_key_schema,
                    table: col.foreign_key_table,
                    column: col.foreign_key_column,
                },
            })
        }

        const fieldPrefix = /[0-9]/g.test(col.name.charAt(0)) ? '_' : ''
        const fieldName = `${fieldPrefix}${col.name}`

        const existingField = modelTable!.fields.find(
            (f) => getDbName(f) === fieldName
        )
        if (!existingField) {
            const builtinType = provider.getBuiltinType(col.datatype)
            const unsupported: UnsupportedFieldType = {
                get $container() {
                    return type
                },
                $type: 'UnsupportedFieldType' as const,
                value: {
                    get $container() {
                        return unsupported
                    },
                    $type: 'StringLiteral',
                    value: col.datatype,
                },
            }

            const type: DataFieldType = {
                get $container() {
                    return field
                },
                $type: 'DataFieldType' as const,
                type: builtinType.type === 'Unsupported' ? undefined : builtinType.type,
                array: builtinType.isArray,
                unsupported:
                    builtinType.type === 'Unsupported' ? unsupported : undefined,
                optional: col.nullable,
                reference: col.options.length
                    ? {
                        $refText: col.datatype,
                        ref: model.declarations.find(
                            (d) => d.$type === 'Enum' && getDbName(d) === col.datatype
                        ) as Enum | undefined,
                    }
                    : undefined,
            }

            const field: DataField = {
                $type: 'DataField' as const,
                type,
                $container: modelTable!,
                name: fieldName,
                get attributes() {
                    if (fieldPrefix !== '') return []

                    const attr: DataFieldAttribute = {
                        $type: 'DataFieldAttribute' as const,
                        get $container() {
                            return field
                        },
                        decl: {
                            $refText: '@map',
                            ref: model.$document?.references.find(
                                (r) =>
                                    //@ts-ignore
                                    r.ref.$type === 'Attribute' && r.ref.name === '@map'
                            )?.ref as Attribute,
                        },
                        get args() {
                            const arg: AttributeArg = {
                                $type: 'AttributeArg' as const,
                                get $container() {
                                    return attr
                                },
                                name: 'name',
                                $resolvedParam: {
                                    name: 'name',
                                },
                                get value() {
                                    return {
                                        $type: 'StringLiteral' as const,
                                        $container: arg,
                                        value: col.name,
                                    }
                                },
                            }

                            return [arg]
                        },
                    }

                    return [attr]
                },
                comments: [],
            }
            return field
        }
        return existingField
    })

    return relations
}

export function syncRelation(model: Model, relation: Relation, services: ZModelServices) {
    const idAttribute = getAttributeRef('@id', services)
    const uniqueAttribute = getAttributeRef('@unique', services)
    const relationAttribute = getAttributeRef('@relation', services)

    if (!idAttribute || !uniqueAttribute || !relationAttribute) {
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
}