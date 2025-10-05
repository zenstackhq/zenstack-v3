import type { ZModelServices } from '@zenstackhq/language';
import { isEnum, type DataField, type DataModel, type Enum, type Model } from '@zenstackhq/language/ast';
import { DataFieldFactory, DataModelFactory, EnumFactory } from '@zenstackhq/language/factory';
import type { PullOptions } from '../db';
import type { IntrospectedEnum, IntrospectedTable, IntrospectionProvider } from './provider';
import { getAttributeRef, getDbName } from './utils';

export function syncEnums({
    dbEnums,
    model,
    options: options,
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
                    .setDecl(getAttributeRef('@@map', services)!)
                    .addArg((argBuilder) => argBuilder.StringLiteral.setValue(dbEnum.enum_type)),
            );

        dbEnum.values.map((v) => {
            const { name, modified } = resolveNameCasing(options, v);
            factory.addField((builder) => {
                builder.setName(name);
                if (modified)
                    builder.addAttribute((builder) =>
                        builder
                            .setDecl(getAttributeRef('@map', services)!)
                            .addArg((argBuilder) => argBuilder.StringLiteral.setValue(v)),
                    );

                return builder;
            });
        });
        model.declarations.push(factory.get({ $container: model }));
    }
}

function resolveNameCasing(options: PullOptions, originalName: string) {
    let name: string;

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
        case 'none':
        default:
            name = originalName;
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

    if (multiPk) {
        const pkColumns = table.columns.filter((c) => c.pk).map((c) => c.name);
        modelFactory.addAttribute((builder) =>
            builder.setDecl(modelIdAttribute).addArg((argBuilder) => {
                const arrayExpr = argBuilder.ArrayExpr;
                pkColumns.map((c) => {
                    const ref = modelFactory.node.fields.find((f) => getDbName(f) === c)!;
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
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
        const { name: _name, modified } = resolveNameCasing(options, column.name);
        const name = `${fieldPrefix}${_name}`;

        const builtinType = provider.getBuiltinType(column.datatype);

        modelFactory.addField((builder) => {
            builder.setName(name);
            builder.setType((typeBuilder) => {
                typeBuilder.setArray(builtinType.isArray);
                typeBuilder.setOptional(column.nullable);

                if (builtinType.type != 'Unsupported') {
                    typeBuilder.setType(builtinType.type);
                } else {
                    typeBuilder.setUnsupported((unsupportedBuilder) =>
                        unsupportedBuilder.setValue((lt) => lt.StringLiteral.setValue(column.datatype)),
                    );
                }

                if (column.options.length > 0) {
                    const ref = model.declarations.find((d) => isEnum(d) && getDbName(d) === column.datatype) as
                        | Enum
                        | undefined;

                    if (ref) {
                        typeBuilder.setReference(ref);
                    }
                }

                return typeBuilder;
            });

            if (column.default) {
                const defaultValuesAttrs = column.default
                    ? provider.getDefaultValue({
                          fieldName: column.name,
                          defaultValue: column.default,
                          services,
                          enums: model.declarations.filter((d) => d.$type === 'Enum') as Enum[],
                      })
                    : [];
                defaultValuesAttrs.forEach(builder.addAttribute);
            }

            if (column.pk && !multiPk) {
                builder.addAttribute((b) => b.setDecl(idAttribute));
            }

            if (column.unique)
                builder.addAttribute((b) => {
                    b.setDecl(uniqueAttribute);
                    if (column.unique_name) b.addArg((ab) => ab.StringLiteral.setValue(column.unique_name!), 'map');

                    return b;
                });
            if (modified)
                builder.addAttribute((ab) =>
                    ab.setDecl(fieldMapAttribute).addArg((ab) => ab.StringLiteral.setValue(column.name), 'name'),
                );

            return builder;
        });
    });

    const uniqieColumns = table.columns.filter((c) => c.unique && !c.pk).map((c) => c.name);
    if (uniqieColumns.length > 0) {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(modelUniqueAttribute).addArg((argBuilder) => {
                const arrayExpr = argBuilder.ArrayExpr;
                uniqieColumns.map((c) => {
                    const ref = modelFactory.node.fields.find((f) => getDbName(f) === c)!;
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
        );
    }

    model.declarations.push(modelFactory.node);

    table.indexes.forEach((index) => {
        modelFactory.addAttribute((builder) =>
            builder.setDecl(modelindexAttribute).addArg((argBuilder) => {
                const arrayExpr = argBuilder.ArrayExpr;
                index.columns.map((c) => {
                    const ref = modelFactory.node.fields.find((f) => getDbName(f) === c.name)!;
                    arrayExpr.addItem((itemBuilder) => itemBuilder.ReferenceExpr.setTarget(ref));
                });
                return arrayExpr;
            }),
        );
    });

    return relations;
}

export function syncRelation({
    model,
    relation,
    services,
}: {
    model: Model;
    relation: Relation;
    services: ZModelServices;
    options: PullOptions;
}) {
    const idAttribute = getAttributeRef('@id', services);
    const uniqueAttribute = getAttributeRef('@unique', services);
    const relationAttribute = getAttributeRef('@relation', services);
    const fieldMapAttribute = getAttributeRef('@map', services);
    const tableMapAttribute = getAttributeRef('@@map', services);

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

    //TODO: Finish relation sync

    const fieldPrefix = /[0-9]/g.test(sourceModel.name.charAt(0)) ? '_' : '';

    const relationName = `${sourceModel.name}_${relation.column}To${targetModel.name}_${relation.references.column}`;

    const sourceFieldFactory = new DataFieldFactory()
        .setContainer(sourceModel)
        .setName(
            `${fieldPrefix}${sourceModel.name.charAt(0).toLowerCase()}${sourceModel.name.slice(1)}_${relation.column}`,
        )
        .setType((tb) =>
            tb
                .setOptional(relation.nullable)
                .setArray(relation.type === 'many')
                .setReference(targetModel),
        )
        .addAttribute((ab) =>
            ab
                .setDecl(relationAttribute)
                .addArg((ab) => ab.StringLiteral.setValue(relationName))
                .addArg((ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(sourceField)), 'fields')
                .addArg((ab) => ab.ArrayExpr.addItem((aeb) => aeb.ReferenceExpr.setTarget(targetField)), 'references')
                .addArg((ab) => ab.ArrayExpr.addItem((aeb) => aeb.StringLiteral.setValue(relation.fk_name)), 'map'),
        );

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
        )
        .addAttribute((ab) => ab.setDecl(relationAttribute).addArg((ab) => ab.StringLiteral.setValue(relationName)));

    targetModel.fields.push(targetFieldFactory.node);
}
