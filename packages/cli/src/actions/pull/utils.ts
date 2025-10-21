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
    StringLiteral,
} from '@zenstackhq/language/ast';
import { getStringLiteral } from '@zenstackhq/language/utils';
import type { DataSourceProviderType } from '@zenstackhq/sdk/schema';
import type { Reference } from 'langium';

export function getAttribute(model: Model, attrName: string) {
    if (!model.$document) throw new Error('Model is not associated with a document.');

    const references = model.$document.references as Reference<AbstractDeclaration>[];
    return references.find((a) => a.ref?.$type === 'Attribute' && a.ref?.name === attrName)?.ref as
        | Attribute
        | undefined;
}

export function getDatasource(model: Model) {
    const datasource = model.declarations.find((d) => d.$type === 'DataSource');
    if (!datasource) {
        throw new Error('No datasource declaration found in the schema.');
    }

    const urlField = datasource.fields.find((f) => f.name === 'url');

    if (!urlField) throw new Error(`No url field found in the datasource declaration.`);

    let url = getStringLiteral(urlField.value);

    if (!url && isInvocationExpr(urlField.value)) {
        const envName = getStringLiteral(urlField.value.args[0]?.value);
        if (!envName) {
            throw new Error('The url field must be a string literal or an env().');
        }
        if (!process.env[envName]) {
            throw new Error(
                `Environment variable ${envName} is not set, please set it to the database connection string.`,
            );
        }
        url = process.env[envName];
    }

    if (!url) {
        throw new Error('The url field must be a string literal or an env().');
    }

    return {
        name: datasource.name,
        provider: getStringLiteral(
            datasource.fields.find((f) => f.name === 'provider')?.value,
        ) as DataSourceProviderType,
        url,
    };
}

export function getDbName(decl: AbstractDeclaration | DataField | EnumField, includeSchema: boolean = false): string {
    if (!('attributes' in decl)) return decl.name;

    const schemaAttr = decl.attributes.find((a) => a.decl.ref?.name === '@@schema');
    const schemaAttrValue = schemaAttr?.args[0]?.value;
    let schema: string;
    if (schemaAttrValue?.$type !== 'StringLiteral') schema = 'public';
    if (!schemaAttr) schema = 'public';
    else schema = (schemaAttr.args[0]?.value as any)?.value as string;

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
    if (!node) throw new Error(`Declaration not found: ${name}`);
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
