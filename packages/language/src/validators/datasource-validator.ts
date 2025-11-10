import type { ValidationAcceptor } from 'langium';
import { SUPPORTED_PROVIDERS } from '../constants';
import { DataSource, isConfigArrayExpr, isInvocationExpr, isLiteralExpr } from '../generated/ast';
import { getStringLiteral } from '../utils';
import { validateDuplicatedDeclarations, type AstValidator } from './common';

/**
 * Validates data source declarations.
 */
export default class DataSourceValidator implements AstValidator<DataSource> {
    validate(ds: DataSource, accept: ValidationAcceptor): void {
        validateDuplicatedDeclarations(ds, ds.fields, accept);
        this.validateProvider(ds, accept);
        this.validateUrl(ds, accept);
    }

    private validateProvider(ds: DataSource, accept: ValidationAcceptor) {
        const provider = ds.fields.find((f) => f.name === 'provider');
        if (!provider) {
            accept('error', 'datasource must include a "provider" field', {
                node: ds,
            });
            return;
        }

        const providerValue = getStringLiteral(provider.value);
        if (!providerValue) {
            accept('error', '"provider" must be set to a string literal', {
                node: provider.value,
            });
        } else if (!SUPPORTED_PROVIDERS.includes(providerValue)) {
            accept(
                'error',
                `Provider "${providerValue}" is not supported. Choose from ${SUPPORTED_PROVIDERS.map(
                    (p) => '"' + p + '"',
                ).join(' | ')}.`,
                { node: provider.value },
            );
        }

        const defaultSchemaField = ds.fields.find((f) => f.name === 'defaultSchema');
        if (defaultSchemaField && providerValue !== 'postgresql') {
            accept('error', '"defaultSchema" is only supported for "postgresql" provider', {
                node: defaultSchemaField,
            });
        }

        const schemasField = ds.fields.find((f) => f.name === 'schemas');
        if (schemasField) {
            if (providerValue !== 'postgresql') {
                accept('error', '"schemas" is only supported for "postgresql" provider', {
                    node: schemasField,
                });
            }
            const schemasValue = schemasField.value;
            if (
                !isConfigArrayExpr(schemasValue) ||
                !schemasValue.items.every((e) => isLiteralExpr(e) && typeof getStringLiteral(e) === 'string')
            ) {
                accept('error', '"schemas" must be an array of string literals', {
                    node: schemasField,
                });
            }
        }
    }

    private validateUrl(ds: DataSource, accept: ValidationAcceptor) {
        const urlField = ds.fields.find((f) => f.name === 'url');
        if (!urlField) {
            return;
        }

        const value = getStringLiteral(urlField.value);
        if (!value && !(isInvocationExpr(urlField.value) && urlField.value.function.ref?.name === 'env')) {
            accept('error', `"${urlField.name}" must be set to a string literal or an invocation of "env" function`, {
                node: urlField.value,
            });
        }
    }
}
