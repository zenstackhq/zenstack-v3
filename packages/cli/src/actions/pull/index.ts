import type { ZModelServices } from '@zenstackhq/language';
import colors from 'colors';
import {
    isEnum,
    type DataField,
    type DataModel,
    type Enum,
    type Model,
} from '@zenstackhq/language/ast';
import {
    DataFieldAttributeFactory,
    DataFieldFactory,
    DataModelFactory,
    EnumFactory,
} from '@zenstackhq/language/factory';
import type { PullOptions } from '../db';
import type { Cascade, IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider';
import { getAttributeRef, getDbName, getEnumRef } from './utils';
import { CliError } from '../../cli-error';

export function syncEnums({
    dbEnums,
    model,
    oldModel,
    provider,
    options,
    services,
    defaultSchema,
}: {
    dbEnums: IntrospectedEnum[];
    model: Model;
    oldModel: Model;
    provider: IntrospectionProvider;
    services: ZModelServices;
    options: PullOptions;
    defaultSchema: string;
}) {
    if (provider.isSupportedFeature('NativeEnum')) {
        for (const dbEnum of dbEnums) {
            const { modified, name } = resolveNameCasing(options.modelCasing, dbEnum.enum_type);
            if (modified) console.log(colors.gray(`Mapping enum ${dbEnum.enum_type} to ${name}`));
            const factory = new EnumFactory().setName(name);
            if (modified || options.alwaysMap)
                factory.addAttribute((builder) =>
                    builder
                        .setDecl(getAttributeRef('@@map', services))
                        .addArg((argBuilder) => argBuilder.StringLiteral.setValue(dbEnum.enum_type)),
                );

            dbEnum.values.forEach((v) => {
                const { name, modified } = resolveNameCasing(options.fieldCasing, v);
                factory.addField((builder) => {
                    builder.setName(name);
                    if (modified || options.alwaysMap)
                        builder.addAttribute((builder) =>
                            builder
                                .setDecl(getAttributeRef('@map', services))
                                .addArg((argBuilder) => argBuilder.StringLiteral.setValue(v)),
                        );

                    return builder;
                });
            });

            if (dbEnum.schema_name && dbEnum.schema_name !== '' && dbEnum.schema_name !== defaultSchema) {
                factory.addAttribute((b) =>
                    b
                        .setDecl(getAttributeRef('@@schema', services))
                        .addArg((a) => a.StringLiteral.setValue(dbEnum.schema_name)),
                );
            }

            model.declarations.push(factory.get({ $container: model }));
        }
    } else {
        oldModel.declarations
            .filter((d) => isEnum(d))
            .forEach((d) => {
                const factory = new EnumFactory().setName(d.name);
                // Copy enum-level comments
                if (d.comments?.length) {
                    factory.update({ comments: [...d.comments] });
                }
                // Copy enum-level attributes (@@map, @@schema, etc.)
                // Re-parent attributes to the new factory node
                if (d.attributes?.length) {
                    const reparentedAttrs = d.attributes.map((attr) => ({ ...attr, $container: factory.node }));
                    factory.update({ attributes: reparentedAttrs });
                }
                // Copy fields with their attributes and comments
                d.fields.forEach((v) => {
                    factory.addField((builder) => {
                        builder.setName(v.name);
                        // Copy field-level comments
                        if (v.comments?.length) {
                            v.comments.forEach((c) => {
                                builder.addComment(c);
                            });
                        }
                        // Copy field-level attributes (@map, etc.)
                        // Re-parent attributes to the new builder node
                        if (v.attributes?.length) {
                            const reparentedAttrs = v.attributes.map((attr) => ({ ...attr, $container: builder.node }));
                            builder.update({ attributes: reparentedAttrs });
                        }
                        return builder;
                    });
                });
                model.declarations.push(factory.get({ $container: model }));
            });
    }
}

function resolveNameCasing(casing: 'pascal' | 'camel' | 'snake' | 'none', originalName: string) {
    let name = originalName;
    const fieldPrefix = /[0-9]/g.test(name.charAt(0)) ? '_' : '';

    switch (casing) {
        case 'pascal':
            name = toPascalCase(originalName);
            break;
        case 'camel':
            name = toCamelCase(originalName);
            break;
        case 'snake':
            name = toSnakeCase(originalName);
            break;
    }

    return {
        modified: name !== originalName || fieldPrefix !== '',
        name: `${fieldPrefix}${name}`,
    };
}

function toPascalCase(str: string): string {
    return str.replace(/[_\- ]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
}

function toCamelCase(str: string): string {
    return str.replace(/[_\- ]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase());
}

function toSnakeCase(str: string): string {
    return str
        .replace(/[- ]+/g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

export type Relation = {
    schema: string;
    table: string;
    column: string;
    type: 'one' | 'many';
    fk_name: string;
    foreign_key_on_update: Cascade;
    foreign_key_on_delete: Cascade;
    nullable: boolean;
    references: {
        schema: string | null;
        table: string | null;
        column: string | null;
        type: 'one' | 'many';
    };
};

export function syncTable({
    model,
    provider,
    table,
    services,
    options,
    defaultSchema,
}: {
    table: IntrospectedTable;
    model: Model;
    oldModel: Model;
    provider: IntrospectionProvider;
    services: ZModelServices;
    options: PullOptions;
    defaultSchema: string;
}) {
    const idAttribute = getAttributeRef('@id', services);
    const modelIdAttribute = getAttributeRef('@@id', services);
    const uniqueAttribute = getAttributeRef('@unique', services);
    const modelUniqueAttribute = getAttributeRef('@@unique', services);
    const relationAttribute = getAttributeRef('@relation', services);
    const fieldMapAttribute = getAttributeRef('@map', services);
    const tableMapAttribute = getAttributeRef('@@map', services);
    const modelindexAttribute = getAttributeRef('@@index', services);

    if (
        !idAttribute ||
        !uniqueAttribute ||
        !relationAttribute ||
        !fieldMapAttribute ||
        !tableMapAttribute ||
        !modelIdAttribute ||
        !modelUniqueAttribute ||
        !modelindexAttribute
    ) {
        throw new CliError('Cannot find required attributes in the model.');
    }

    const relations: Relation[] = [];
    const { name, modified } = resolveNameCasing(options.modelCasing, table.name);
    const multiPk = table.columns.filter((c) => c.pk).length > 1;

    const modelFactory = new DataModelFactory().setName(name).setIsView(table.type === 'view');
    modelFactory.setContainer(model);

    if (modified || options.alwaysMap) {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(tableMapAttribute).addArg((argBuilder) => argBuilder.StringLiteral.setValue(table.name)),
        );
    }
    table.columns.forEach((column) => {
        if (column.foreign_key_table) {
            // Check if this FK column is the table's single-column primary key
            // If so, it should be treated as a one-to-one relation
            const isSingleColumnPk = !multiPk && column.pk;
            relations.push({
                schema: table.schema,
                table: table.name,
                column: column.name,
                type: 'one',
                fk_name: column.foreign_key_name!,
                foreign_key_on_delete: column.foreign_key_on_delete,
                foreign_key_on_update: column.foreign_key_on_update,
                nullable: column.nullable,
                references: {
                    schema: column.foreign_key_schema,
                    table: column.foreign_key_table,
                    column: column.foreign_key_column,
                    type: column.unique || isSingleColumnPk ? 'one' : 'many',
                },
            });
        }

        const { name, modified } = resolveNameCasing(options.fieldCasing, column.name);

        const builtinType = provider.getBuiltinType(column.datatype);

        modelFactory.addField((builder) => {
            builder.setName(name);
            builder.setType((typeBuilder) => {
                typeBuilder.setArray(builtinType.isArray);
                typeBuilder.setOptional(column.nullable);

                if (column.datatype === 'enum') {
                    const ref = model.declarations.find((d) => isEnum(d) && getDbName(d) === column.datatype_name) as
                        | Enum
                        | undefined;

                    if (!ref) {
                        throw new CliError(`Enum ${column.datatype_name} not found`);
                    }
                    typeBuilder.setReference(ref);
                } else {
                    if (builtinType.type !== 'Unsupported') {
                        typeBuilder.setType(builtinType.type);
                    } else {
                        typeBuilder.setUnsupported((unsupportedBuilder) =>
                            unsupportedBuilder.setValue((lt) => lt.StringLiteral.setValue(column.datatype)),
                        );
                    }
                }

                return typeBuilder;
            });

            if (column.pk && !multiPk) {
                builder.addAttribute((b) => b.setDecl(idAttribute));
            }

            // Add field-type-based attributes (e.g., @updatedAt for DateTime fields, @db.* attributes)
            const fieldAttrs = provider.getFieldAttributes({
                fieldName: column.name,
                fieldType: builtinType.type,
                datatype: column.datatype,
                length: column.length,
                precision: column.precision,
                services,
            });
            fieldAttrs.forEach(builder.addAttribute.bind(builder));

            if (column.default) {
                const defaultExprBuilder = provider.getDefaultValue({
                    fieldType: builtinType.type,
                    datatype: column.datatype,
                    datatype_name: column.datatype_name,
                    defaultValue: column.default,
                    services,
                    enums: model.declarations.filter((d) => d.$type === 'Enum') as Enum[],
                });
                if (defaultExprBuilder) {
                    const defaultAttr = new DataFieldAttributeFactory()
                        .setDecl(getAttributeRef('@default', services))
                        .addArg(defaultExprBuilder);
                    builder.addAttribute(defaultAttr);
                }
            }

            if (column.unique && !column.pk) {
                builder.addAttribute((b) => {
                    b.setDecl(uniqueAttribute);
                    // Only add map if the unique constraint name differs from default patterns
                    // Default patterns: TableName_columnName_key (Prisma) or just columnName (MySQL)
                    const isDefaultName = !column.unique_name
                        || column.unique_name === `${table.name}_${column.name}_key`
                        || column.unique_name === column.name;
                    if (!isDefaultName) {
                        b.addArg((ab) => ab.StringLiteral.setValue(column.unique_name!), 'map');
                    }

                    return b;
                });
            }
            if (modified || options.alwaysMap) {
                builder.addAttribute((ab) =>
                    ab.setDecl(fieldMapAttribute).addArg((ab) => ab.StringLiteral.setValue(column.name)),
                );
            }

            return builder;
        });
    });

    const pkColumns = table.columns.filter((c) => c.pk).map((c) => c.name);
    if (multiPk) {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(modelIdAttribute).addArg((argBuilder) => {
                const arrayExpr = argBuilder.ArrayExpr;
                pkColumns.forEach((c) => {
                    const ref = modelFactory.node.fields.find((f) => getDbName(f) === c);
                    if (!ref) {
                        throw new CliError(`Field ${c} not found`);
                    }
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
        );
    }

    const hasUniqueConstraint =
        table.columns.some((c) => c.unique || c.pk) ||
        table.indexes.some((i) => i.unique);
    if (!hasUniqueConstraint) {
        modelFactory.addAttribute((a) => a.setDecl(getAttributeRef('@@ignore', services)));
        modelFactory.comments.push(
            '/// The underlying table does not contain a valid unique identifier and can therefore currently not be handled by Zenstack Client.',
        );
    }

    // Sort indexes: unique indexes first, then other indexes
    const sortedIndexes = table.indexes.reverse().sort((a, b) => {
        if (a.unique && !b.unique) return -1;
        if (!a.unique && b.unique) return 1;
        return 0;
    });

    sortedIndexes.forEach((index) => {
        if (index.predicate) {
            //These constraints are not supported by Zenstack, because Zenstack currently does not fully support check constraints. Read more: https://pris.ly/d/check-constraints
            console.warn(
                colors.yellow(
                    `These constraints are not supported by Zenstack. Read more: https://pris.ly/d/check-constraints\n- Model: "${table.name}", constraint: "${index.name}"`,
                ),
            );
            return;
        }
        if (index.columns.find((c) => c.expression)) {
            console.warn(
                colors.yellow(
                    `These constraints are not supported by Zenstack. Read more: https://pris.ly/d/check-constraints\n- Model: "${table.name}", constraint: "${index.name}"`,
                ),
            );
            return;
        }

        // Skip PRIMARY key index (handled via @id or @@id)
        if (index.primary) {
            return;
        }

        // Skip single-column indexes that are already handled by @id or @unique on the field
        if (index.columns.length === 1 && (index.columns.find((c) => pkColumns.includes(c.name)) || index.unique)) {
            return;
        }

        modelFactory.addAttribute((builder) =>
        {
            const attr = builder
                .setDecl(index.unique ? modelUniqueAttribute : modelindexAttribute)
                .addArg((argBuilder) => {
                    const arrayExpr = argBuilder.ArrayExpr;
                    index.columns.forEach((c) => {
                        const ref = modelFactory.node.fields.find((f) => getDbName(f) === c.name);
                        if (!ref) {
                            throw new CliError(`Column ${c.name} not found in model ${table.name}`);
                        }
                        arrayExpr.addItem((itemBuilder) => {
                            const refExpr = itemBuilder.ReferenceExpr.setTarget(ref);
                            if (c.order && c.order !== 'ASC')
                                refExpr.addArg((ab) => ab.StringLiteral.setValue('DESC'), 'sort');

                            return refExpr;
                        });
                    });
                    return arrayExpr;
                });

                const suffix = index.unique ? '_key' : '_idx';

                if(index.name !== `${table.name}_${index.columns.map(c => c.name).join('_')}${suffix}`){
                    attr.addArg((argBuilder) => argBuilder.StringLiteral.setValue(index.name), 'map');
                }

            return attr
        }

        );
    });
    if (table.schema && table.schema !== '' && table.schema !== defaultSchema) {
        modelFactory.addAttribute((b) =>
            b.setDecl(getAttributeRef('@@schema', services)).addArg((a) => a.StringLiteral.setValue(table.schema)),
        );
    }

    model.declarations.push(modelFactory.node);
    return relations;
}

export function syncRelation({
    model,
    relation,
    services,
    options,
    selfRelation,
    similarRelations,
}: {
    model: Model;
    relation: Relation;
    services: ZModelServices;
    options: PullOptions;
    //self included
    similarRelations: number;
    selfRelation: boolean;
}) {
    const idAttribute = getAttributeRef('@id', services);
    const uniqueAttribute = getAttributeRef('@unique', services);
    const relationAttribute = getAttributeRef('@relation', services);
    const fieldMapAttribute = getAttributeRef('@map', services);
    const tableMapAttribute = getAttributeRef('@@map', services);

    const includeRelationName = selfRelation || similarRelations > 0;

    if (!idAttribute || !uniqueAttribute || !relationAttribute || !fieldMapAttribute || !tableMapAttribute) {
        throw new CliError('Cannot find required attributes in the model.');
    }

    const sourceModel = model.declarations.find((d) => d.$type === 'DataModel' && getDbName(d) === relation.table) as
        | DataModel
        | undefined;
    if (!sourceModel) return;

    const sourceFieldId = sourceModel.fields.findIndex((f) => getDbName(f) === relation.column);
    const sourceField = sourceModel.fields[sourceFieldId] as DataField | undefined;
    if (!sourceField) return;

    const targetModel = model.declarations.find(
        (d) => d.$type === 'DataModel' && getDbName(d) === relation.references.table,
    ) as DataModel | undefined;
    if (!targetModel) return;

    const targetField = targetModel.fields.find((f) => getDbName(f) === relation.references.column);
    if (!targetField) return;

    const fieldPrefix = /[0-9]/g.test(sourceModel.name.charAt(0)) ? '_' : '';

    const relationName = `${relation.table}${similarRelations > 0 ? `_${relation.column}` : ''}To${relation.references.table}`;

    const sourceNameFromReference = sourceField.name.toLowerCase().endsWith('id') ? `${resolveNameCasing("camel", sourceField.name.slice(0, -2)).name}${relation.type === 'many'? 's' : ''}` : undefined;

    const sourceFieldFromReference = sourceModel.fields.find((f) => f.name === sourceNameFromReference);

    let { name: sourceFieldName } = resolveNameCasing(
        options.fieldCasing,
        similarRelations > 0
            ? `${fieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`
            : `${(!sourceFieldFromReference? sourceNameFromReference : undefined) || resolveNameCasing("camel", targetModel.name).name}${relation.type === 'many'? 's' : ''}`,
    );

    if (sourceModel.fields.find((f) => f.name === sourceFieldName)) {
        sourceFieldName = `${sourceFieldName}To${targetModel.name.charAt(0).toLowerCase()}${targetModel.name.slice(1)}_${relation.references.column}`;
    }

    const sourceFieldFactory = new DataFieldFactory()
        .setContainer(sourceModel)
        .setName(sourceFieldName)
        .setType((tb) =>
            tb
                .setOptional(relation.nullable)
                .setArray(relation.type === 'many')
                .setReference(targetModel),
        );
    sourceFieldFactory.addAttribute((ab) => {
        ab.setDecl(relationAttribute);
        if (includeRelationName) ab.addArg((ab) => ab.StringLiteral.setValue(relationName));
        ab.addArg((ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(sourceField)), 'fields').addArg(
            (ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(targetField)),
            'references',
        );

        // Prisma defaults: onDelete is SetNull for optional, Restrict for mandatory
        const onDeleteDefault = relation.nullable ? 'SET NULL' : 'RESTRICT';
        if (relation.foreign_key_on_delete && relation.foreign_key_on_delete !== onDeleteDefault) {
            const enumRef = getEnumRef('ReferentialAction', services);
            if (!enumRef) throw new CliError('ReferentialAction enum not found');
            const enumFieldRef = enumRef.fields.find(
                (f) => f.name.toLowerCase() === relation.foreign_key_on_delete!.replace(/ /g, '').toLowerCase(),
            );
            if (!enumFieldRef) throw new CliError(`ReferentialAction ${relation.foreign_key_on_delete} not found`);
            ab.addArg((a) => a.ReferenceExpr.setTarget(enumFieldRef), 'onDelete');
        }

        // Prisma default: onUpdate is Cascade
        if (relation.foreign_key_on_update && relation.foreign_key_on_update !== 'CASCADE') {
            const enumRef = getEnumRef('ReferentialAction', services);
            if (!enumRef) throw new CliError('ReferentialAction enum not found');
            const enumFieldRef = enumRef.fields.find(
                (f) => f.name.toLowerCase() === relation.foreign_key_on_update!.replace(/ /g, '').toLowerCase(),
            );
            if (!enumFieldRef) throw new CliError(`ReferentialAction ${relation.foreign_key_on_update} not found`);
            ab.addArg((a) => a.ReferenceExpr.setTarget(enumFieldRef), 'onUpdate');
        }

        if (relation.fk_name && relation.fk_name !== `${relation.table}_${relation.column}_fkey`) ab.addArg((ab) => ab.StringLiteral.setValue(relation.fk_name), 'map');

        return ab;
    });

    sourceModel.fields.splice(sourceFieldId, 0, sourceFieldFactory.node); // Remove the original scalar foreign key field

    const oppositeFieldPrefix = /[0-9]/g.test(targetModel.name.charAt(0)) ? '_' : '';
    const { name: oppositeFieldName } = resolveNameCasing(
        options.fieldCasing,
        similarRelations > 0
            ? `${oppositeFieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`
            : `${resolveNameCasing("camel", sourceModel.name).name}${relation.references.type === 'many'? 's' : ''}`,
    );

    const targetFieldFactory = new DataFieldFactory()
        .setContainer(targetModel)
        .setName(oppositeFieldName)
        .setType((tb) =>
            tb
                .setOptional(relation.references.type === 'one')
                .setArray(relation.references.type === 'many')
                .setReference(sourceModel),
        );
    if (includeRelationName)
        targetFieldFactory.addAttribute((ab) =>
            ab.setDecl(relationAttribute).addArg((ab) => ab.StringLiteral.setValue(relationName)),
        );

    targetModel.fields.push(targetFieldFactory.node);
}
