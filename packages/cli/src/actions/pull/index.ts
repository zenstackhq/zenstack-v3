import type { ZModelServices } from '@zenstackhq/language';
import { Attribute, isEnum, type DataField, type DataModel, type Enum, type Model } from '@zenstackhq/language/ast';
import {
  DataFieldAttributeFactory,
  DataFieldFactory,
  DataModelFactory,
  EnumFactory
} from '@zenstackhq/language/factory';
import type { PullOptions } from '../db';
import type { Cascade, IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider';
import { getAttributeRef, getDbName, getEnumRef } from './utils';

export function syncEnums({
    dbEnums,
    model,
    options,
    services,
}: {
    dbEnums: IntrospectedEnum[];
    model: Model;
    services: ZModelServices;
    options: PullOptions;
}) {
    for (const dbEnum of dbEnums) {
        const { modified, name } = resolveNameCasing(options, dbEnum.enum_type);
        if (modified) console.log(`Mapping enum ${dbEnum.enum_type} to ${name}`);
        const factory = new EnumFactory().setName(name);
        if (modified)
            factory.addAttribute((builder) =>
                builder
                    .setDecl(getAttributeRef('@@map', services))
                    .addArg((argBuilder) => argBuilder.StringLiteral.setValue(dbEnum.enum_type)),
            );

        dbEnum.values.forEach((v) => {
            const { name, modified } = resolveNameCasing(options, v);
            factory.addField((builder) => {
                builder.setName(name);
                if (modified)
                    builder.addAttribute((builder) =>
                        builder
                            .setDecl(getAttributeRef('@map', services))
                            .addArg((argBuilder) => argBuilder.StringLiteral.setValue(v)),
                    );

                return builder;
            });
        });

        try {
            if (dbEnum.schema_name && dbEnum.schema_name !== '' && dbEnum.schema_name !== 'public') {
                factory.addAttribute((b) =>
                    b
                        .setDecl(getAttributeRef('@@schema', services))
                        .addArg((a) => a.StringLiteral.setValue(dbEnum.schema_name)),
                );
            }
        } catch (_error: unknown) {
            //Waiting to support multi-schema
            //TODO: remove catch after multi-schema support is implemented
        }

        model.declarations.push(factory.get({ $container: model }));
    }
}

function resolveNameCasing(options: PullOptions, originalName: string) {
    let name = originalName;

    switch (options.naming) {
        case 'pascal':
            name = toPascalCase(originalName);
            break;
        case 'camel':
            name = toCamelCase(originalName);
            break;
        case 'snake':
            name = toSnakeCase(originalName);
            break;
        case 'kebab':
            name = toKebabCase(originalName);
            break;
    }

    return {
        modified: options.alwaysMap ? true : name !== originalName,
        name,
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

function toKebabCase(str: string): string {
    return str
        .replace(/[_ ]+/g, '-')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
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
}: {
    table: IntrospectedTable;
    model: Model;
    provider: IntrospectionProvider;
    services: ZModelServices;
    options: PullOptions;
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
        throw new Error('Cannot find required attributes in the model.');
    }

    const relations: Relation[] = [];
    const { name, modified } = resolveNameCasing({ ...options, naming: 'pascal' }, table.name);
    const multiPk = table.columns.filter((c) => c.pk).length > 1;

    const modelFactory = new DataModelFactory().setName(name).setIsView(table.type === 'view');
    modelFactory.setContainer(model);

    if (modified) {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(tableMapAttribute).addArg((argBuilder) => argBuilder.StringLiteral.setValue(table.name)),
        );
    }

    table.columns.forEach((column) => {
        if (column.foreign_key_table) {
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
                    type: column.unique ? 'one' : 'many',
                },
            });
        }

        const fieldPrefix = /[0-9]/g.test(column.name.charAt(0)) ? '_' : '';
        const { name: _name, modified: _modified } = resolveNameCasing(options, column.name);
        const name = `${fieldPrefix}${_name}`;
        const modified = fieldPrefix !== '' || _modified;

        const builtinType = provider.getBuiltinType(column.datatype);

        modelFactory.addField((builder) => {
            builder.setName(name);
            builder.setType((typeBuilder) => {
                typeBuilder.setArray(builtinType.isArray);
                typeBuilder.setOptional(column.nullable);

                if (column.options.length > 0) {
                    const ref = model.declarations.find((d) => isEnum(d) && getDbName(d) === column.datatype) as
                        | Enum
                        | undefined;

                    if (!ref) {
                        throw new Error(`Enum ${column.datatype} not found`);
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

            if (column.default) {
                const defaultValuesAttrs = provider.getDefaultValue({
                    fieldName: column.name,
                    defaultValue: column.default,
                    services,
                    enums: model.declarations.filter((d) => d.$type === 'Enum') as Enum[],
                });
                defaultValuesAttrs.forEach(builder.addAttribute.bind(builder));
            }

            if (column.pk && !multiPk) {
                builder.addAttribute((b) => b.setDecl(idAttribute));
            }

            if (column.unique && !column.pk) {
                builder.addAttribute((b) => {
                    b.setDecl(uniqueAttribute);
                    if (column.unique_name) b.addArg((ab) => ab.StringLiteral.setValue(column.unique_name!), 'map');

                    return b;
                });
            }
            if (modified) {
                builder.addAttribute((ab) =>
                    ab.setDecl(fieldMapAttribute).addArg((ab) => ab.StringLiteral.setValue(column.name)),
                );
            }

            const dbAttr = services.shared.workspace.IndexManager.allElements('Attribute').find(
                (d) => d.name.toLowerCase() === `@db.${column.datatype.toLowerCase()}`,
            )?.node as Attribute | undefined;
            //TODO: exclude default types like text in postgres
            //because Zenstack string = text in postgres so unnecessary to map to default types
            if (dbAttr && !['text'].includes(column.datatype)) {
                const dbAttrFactory = new DataFieldAttributeFactory().setDecl(dbAttr);
                if (column.length || column.precision)
                    dbAttrFactory.addArg((a) => a.NumberLiteral.setValue(column.length! || column.precision!));
                builder.addAttribute(dbAttrFactory);
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
                        throw new Error(`Field ${c} not found`);
                    }
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
        );
    }

    const uniqueColumns = table.columns.filter((c) => c.unique && !c.pk).map((c) => c.name);
    if (uniqueColumns.length > 0) {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(modelUniqueAttribute).addArg((argBuilder) => {
                const arrayExpr = argBuilder.ArrayExpr;
                uniqueColumns.forEach((c) => {
                    const ref = modelFactory.node.fields.find((f) => getDbName(f) === c);
                    if (!ref) {
                        throw new Error(`Field ${c} not found`);
                    }
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
        );
    } else {
        modelFactory.addAttribute((a) => a.setDecl(getAttributeRef('@@ignore', services)));
        modelFactory.comments.push(
            '/// The underlying table does not contain a valid unique identifier and can therefore currently not be handled by Zenstack Client.',
        );
    }

    table.indexes.forEach((index) => {
        if (index.predicate) {
            //These constraints are not supported by Zenstack, because Zenstack currently does not fully support check constraints. Read more: https://pris.ly/d/check-constraints
            console.log(
                'These constraints are not supported by Zenstack. Read more: https://pris.ly/d/check-constraints',
                `- Model: "${table.name}", constraint: "${index.name}"`,
            );
            return;
        }
        if (index.columns.find((c) => c.expression)) {
            console.log(
                'These constraints are not supported by Zenstack. Read more: https://pris.ly/d/check-constraints',
                `- Model: "${table.name}", constraint: "${index.name}"`,
            );
            return;
        }

        if (index.columns.length === 1 && index.columns.find((c) => pkColumns.includes(c.name))) {
            //skip primary key
            return;
        }

        modelFactory.addAttribute((builder) =>
            builder
                .setDecl(index.unique ? modelUniqueAttribute : modelindexAttribute)
                .addArg((argBuilder) => {
                    const arrayExpr = argBuilder.ArrayExpr;
                    index.columns.forEach((c) => {
                        const ref = modelFactory.node.fields.find((f) => getDbName(f) === c.name);
                        if (!ref) {
                            throw new Error(`Column ${c.name} not found in model ${table.name}`);
                        }
                        arrayExpr.addItem((itemBuilder) => {
                            const refExpr = itemBuilder.ReferenceExpr.setTarget(ref);
                            if (c.order !== 'ASC') refExpr.addArg((ab) => ab.StringLiteral.setValue('DESC'), 'sort');

                            return refExpr;
                        });
                    });
                    return arrayExpr;
                })
                .addArg((argBuilder) => argBuilder.StringLiteral.setValue(index.name), 'map'),
        );
    });

    try {
        if (table.schema && table.schema !== '' && table.schema !== 'public') {
            modelFactory.addAttribute((b) =>
                b.setDecl(getAttributeRef('@@schema', services)).addArg((a) => a.StringLiteral.setValue(table.schema)),
            );
        }
    } catch (_error: unknown) {
        //Waiting to support multi-schema
        //TODO: remove catch after multi-schema support is implemented
    }

    model.declarations.push(modelFactory.node);

    return relations;
}

export function syncRelation({
    model,
    relation,
    services,
    selfRelation,
    simmilarRelations,
}: {
    model: Model;
    relation: Relation;
    services: ZModelServices;
    options: PullOptions;
    //self included
    simmilarRelations: number;
    selfRelation: boolean;
}) {
    const idAttribute = getAttributeRef('@id', services);
    const uniqueAttribute = getAttributeRef('@unique', services);
    const relationAttribute = getAttributeRef('@relation', services);
    const fieldMapAttribute = getAttributeRef('@map', services);
    const tableMapAttribute = getAttributeRef('@@map', services);

    const includeRelationName = selfRelation || simmilarRelations > 1;

    if (!idAttribute || !uniqueAttribute || !relationAttribute || !fieldMapAttribute || !tableMapAttribute) {
        throw new Error('Cannot find required attributes in the model.');
    }

    const sourceModel = model.declarations.find((d) => d.$type === 'DataModel' && getDbName(d) === relation.table) as
        | DataModel
        | undefined;
    if (!sourceModel) return;

    const sourceField = sourceModel.fields.find((f) => getDbName(f) === relation.column) as DataField | undefined;
    if (!sourceField) return;

    const targetModel = model.declarations.find(
        (d) => d.$type === 'DataModel' && getDbName(d) === relation.references.table,
    ) as DataModel | undefined;
    if (!targetModel) return;

    const targetField = targetModel.fields.find((f) => getDbName(f) === relation.references.column);
    if (!targetField) return;

    const fieldPrefix = /[0-9]/g.test(sourceModel.name.charAt(0)) ? '_' : '';

    const relationName = `${relation.table}${simmilarRelations > 1 ? `_${relation.column}` : ''}To${relation.references.table}`;
    let sourceFieldName = `${fieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`;

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
        )
        .addAttribute((ab) => {
            ab.setDecl(relationAttribute);
            if (includeRelationName) ab.addArg((ab) => ab.StringLiteral.setValue(relationName));
            ab.addArg((ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(sourceField)), 'fields').addArg(
                (ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(targetField)),
                'references',
            );

            if (relation.foreign_key_on_delete && relation.foreign_key_on_delete !== 'SET NULL') {
                const enumRef = getEnumRef('ReferentialAction', services);
                if (!enumRef) throw new Error('ReferentialAction enum not found');
                const enumFieldRef = enumRef.fields.find(
                    (f) => f.name.toLowerCase() === relation.foreign_key_on_delete!.replace(/ /g, '').toLowerCase(),
                );
                if (!enumFieldRef) throw new Error(`ReferentialAction ${relation.foreign_key_on_delete} not found`);
                ab.addArg((a) => a.ReferenceExpr.setTarget(enumFieldRef), 'onDelete');
            }

            if (relation.foreign_key_on_update && relation.foreign_key_on_update !== 'SET NULL') {
                const enumRef = getEnumRef('ReferentialAction', services);
                if (!enumRef) throw new Error('ReferentialAction enum not found');
                const enumFieldRef = enumRef.fields.find(
                    (f) => f.name.toLowerCase() === relation.foreign_key_on_update!.replace(/ /g, '').toLowerCase(),
                );
                if (!enumFieldRef) throw new Error(`ReferentialAction ${relation.foreign_key_on_update} not found`);
                ab.addArg((a) => a.ReferenceExpr.setTarget(enumFieldRef), 'onUpdate');
            }

            ab.addArg((ab) => ab.StringLiteral.setValue(relation.fk_name), 'map');

            return ab;
        });

    sourceModel.fields.push(sourceFieldFactory.node);

    const oppositeFieldPrefix = /[0-9]/g.test(targetModel.name.charAt(0)) ? '_' : '';
    const oppositeFieldName =
        relation.type === 'one'
            ? `${oppositeFieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}s`
            : `${oppositeFieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`;

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
