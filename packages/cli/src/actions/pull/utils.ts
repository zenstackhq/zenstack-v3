import type { ZModelServices } from '@zenstackhq/language';
import {
    type AbstractDeclaration,
    type DataField,
    type DataModel,
    type Enum,
    type EnumField,
    type FunctionDecl,
    isInvocationExpr,
    type Attribute,
    type Model,
    type ReferenceExpr,
    type StringLiteral,
} from '@zenstackhq/language/ast';
import { getLiteralArray, getStringLiteral } from '@zenstackhq/language/utils';
import type { DataSourceProviderType } from '@zenstackhq/schema';
import type { Reference } from 'langium';
import { CliError } from '../../cli-error';

export function getAttribute(model: Model, attrName: string) {
    if (!model.$document) throw new CliError('Model is not associated with a document.');

    const references = model.$document.references as Reference<AbstractDeclaration>[];
    return references.find((a) => a.ref?.$type === 'Attribute' && a.ref?.name === attrName)?.ref as
        | Attribute
        | undefined;
}

export function getDatasource(model: Model) {
    const datasource = model.declarations.find((d) => d.$type === 'DataSource');
    if (!datasource) {
        throw new CliError('The schema\'s "datasource" must have a "url" field to use this command.');
    }

    const urlField = datasource.fields.find((f) => f.name === 'url');

    if (!urlField) throw new CliError(`No url field found in the datasource declaration.`);

    let url = getStringLiteral(urlField.value);

    if (!url && isInvocationExpr(urlField.value)) {
        const envName = getStringLiteral(urlField.value.args[0]?.value);
        if (!envName) {
            throw new CliError('The url field must be a string literal or an env().');
        }
        if (!process.env[envName]) {
            throw new CliError(
                `Environment variable ${envName} is not set, please set it to the database connection string.`,
            );
        }
        url = process.env[envName];
    }

    if (!url) {
        throw new CliError('The url field must be a string literal or an env().');
    }

    if (url.startsWith('file:')) {
        url = new URL(url, `file:${model.$document!.uri.path}`).pathname;
        if (process.platform === 'win32' && url[0] === '/') url = url.slice(1);
    }

    const defaultSchemaField = datasource.fields.find((f) => f.name === 'defaultSchema');
    const defaultSchema = (defaultSchemaField && getStringLiteral(defaultSchemaField.value)) || 'public';

    const schemasField = datasource.fields.find((f) => f.name === 'schemas');
    const schemas =
    (schemasField &&
        getLiteralArray(schemasField.value)
        ?.filter((s) => s !== undefined)) as string[] ||
        [];

    return {
        name: datasource.name,
        provider: getStringLiteral(
            datasource.fields.find((f) => f.name === 'provider')?.value,
        ) as DataSourceProviderType,
        url,
        defaultSchema,
        schemas,
        allSchemas: [defaultSchema, ...schemas],
    };
}

export function getDbName(decl: AbstractDeclaration | DataField | EnumField, includeSchema: boolean = false): string {
    if (!('attributes' in decl)) return decl.name;

    const schemaAttr = decl.attributes.find((a) => a.decl.ref?.name === '@@schema');
    let schema = 'public';
    if (schemaAttr) {
        const schemaAttrValue = schemaAttr.args[0]?.value;
        if (schemaAttrValue?.$type === 'StringLiteral') {
            schema = schemaAttrValue.value;
        }
    }

    const formatName = (name: string) => `${schema && includeSchema ? `${schema}.` : ''}${name}`;

    const nameAttr = decl.attributes.find((a) => a.decl.ref?.name === '@@map' || a.decl.ref?.name === '@map');
    if (!nameAttr) return formatName(decl.name);
    const attrValue = nameAttr.args[0]?.value;

    if (attrValue?.$type !== 'StringLiteral') return formatName(decl.name);

    return formatName(attrValue.value);
}

export function getRelationFkName(decl: DataField): string | undefined {
    const relationAttr = decl?.attributes.find((a) => a.decl.ref?.name === '@relation');
    const schemaAttrValue = relationAttr?.args.find((a) => a.name === 'map')?.value as StringLiteral;
    return schemaAttrValue?.value;
}

/**
 * Gets the FK field names from the @relation attribute's `fields` argument.
 * Returns a sorted, comma-separated string of field names for comparison.
 * e.g., @relation(fields: [userId], references: [id]) -> "userId"
 * e.g., @relation(fields: [postId, tagId], references: [id, id]) -> "postId,tagId"
 */
export function getRelationFieldsKey(decl: DataField): string | undefined {
    const relationAttr = decl?.attributes.find((a) => a.decl.ref?.name === '@relation');
    if (!relationAttr) return undefined;

    const fieldsArg = relationAttr.args.find((a) => a.name === 'fields')?.value;
    if (!fieldsArg || fieldsArg.$type !== 'ArrayExpr') return undefined;

    const fieldNames = fieldsArg.items
        .filter((item): item is ReferenceExpr => item.$type === 'ReferenceExpr')
        .map((item) => item.target?.$refText || item.target?.ref?.name)
        .filter((name): name is string => !!name)
        .sort();

    return fieldNames.length > 0 ? fieldNames.join(',') : undefined;
}

export function getDbSchemaName(decl: DataModel | Enum): string {
    const schemaAttr = decl.attributes.find((a) => a.decl.ref?.name === '@@schema');
    if (!schemaAttr) return 'public';
    const attrValue = schemaAttr.args[0]?.value;

    if (attrValue?.$type !== 'StringLiteral') return 'public';

    return attrValue.value;
}

export function getDeclarationRef<T extends AbstractDeclaration>(
    type: T['$type'],
    name: string,
    services: ZModelServices,
) {
    const node = services.shared.workspace.IndexManager.allElements(type).find(
        (m) => m.node && getDbName(m.node as T) === name,
    )?.node;
    if (!node) throw new CliError(`Declaration not found: ${name}`);
    return node as T;
}

export function getEnumRef(name: string, services: ZModelServices) {
    return getDeclarationRef<Enum>('Enum', name, services);
}

export function getModelRef(name: string, services: ZModelServices) {
    return getDeclarationRef<DataModel>('DataModel', name, services);
}

export function getAttributeRef(name: string, services: ZModelServices) {
    return getDeclarationRef<Attribute>('Attribute', name, services);
}

export function getFunctionRef(name: string, services: ZModelServices) {
    return getDeclarationRef<FunctionDecl>('FunctionDecl', name, services);
}
