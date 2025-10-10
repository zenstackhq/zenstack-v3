import type { ZModelServices } from '@zenstackhq/language';
import {
    AbstractDeclaration,
    DataField,
    DataModel,
    Enum,
    EnumField,
    FunctionDecl,
    isInvocationExpr,
    type Attribute,
    type Model,
} from '@zenstackhq/language/ast';
import { getStringLiteral } from '@zenstackhq/language/utils';
import type { DataSourceProviderType } from '@zenstackhq/sdk/schema';
import type { Reference } from 'langium';

export function getAttribute(model: Model, attrName: string) {
    const references = model.$document!.references as Reference<AbstractDeclaration>[];
    return references.find((a) => a.ref!.$type === 'Attribute' && a.ref!.name === attrName)?.ref as
        | Attribute
        | undefined;
}

export function getDatasource(model: Model) {
    const datasource = model.declarations.find((d) => d.$type === 'DataSource');
    if (!datasource) {
        throw new Error('No datasource declaration found in the schema.');
    }

    const urlField = datasource.fields.find((f) => f.name === 'url')!;

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

export function getDbName(decl: AbstractDeclaration | DataField | EnumField): string {
    if (!('attributes' in decl)) return decl.name;
    const nameAttr = decl.attributes.find((a) => a.decl.ref?.name === '@@map' || a.decl.ref?.name === '@map');
    if (!nameAttr) return decl.name;
    const attrValue = nameAttr.args[0]?.value;

    if (attrValue?.$type !== 'StringLiteral') return decl.name;

    return attrValue.value;
}

export function getDeclarationRef<T extends AbstractDeclaration>(
    type: T['$type'],
    name: string,
    services: ZModelServices,
) {
    return services.shared.workspace.IndexManager.allElements(type).find(
        (m) => m.node && getDbName(m.node as T) === name,
    )?.node as T | undefined;
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
