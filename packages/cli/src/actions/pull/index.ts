import type { ZModelServices } from '@zenstackhq/language'
import type {
    ArrayExpr,
    Attribute,
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
import { getStringLiteral } from '@zenstackhq/language/utils'
import type { IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider'
import { getAttributeRef, getDbName, getEnumRef, getModelRef } from './utils'

export function syncEnums({ dbEnums, model, services }: { dbEnums: IntrospectedEnum[], model: Model, services: ZModelServices }) {
    for (const dbEnum of dbEnums) {
        let schemaEnum = getEnumRef(dbEnum.enum_type, services);

        if (!schemaEnum) {
            console.log(`Adding enum for type ${dbEnum.enum_type}`);
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
    services
}: {
    table: IntrospectedTable
    model: Model
    provider: IntrospectionProvider
    services: ZModelServices
}) {
    const idAttribute = getAttributeRef('@id', services)
    const uniqueAttribute = getAttributeRef('@unique', services)
    const relationAttribute = getAttributeRef('@relation', services)
    const fieldMapAttribute = getAttributeRef('@map', services)
    const tableMapAttribute = getAttributeRef('@@map', services)

    if (!idAttribute || !uniqueAttribute || !relationAttribute || !fieldMapAttribute || !tableMapAttribute) {
        throw new Error('Cannot find required attributes in the model.')
    }

    const relations: Relation[] = []
    let modelTable = getModelRef(table.name, services)

    if (!modelTable) {
        console.log(`Adding model for table ${table.name}`);

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
                type: 'one',
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

                    return [{
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
                                name: 'name',
                                $resolvedParam: {
                                    name: 'name',
                                },
                                get value() {
                                    return {
                                        $type: 'StringLiteral' as const,
                                        $container: this,
                                        value: col.name,
                                    }
                                },
                            }] satisfies AttributeArg[]
                        },
                    }] satisfies DataFieldAttribute[]
                },
                comments: [],
            }
            return field
        }
        return existingField
    })

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