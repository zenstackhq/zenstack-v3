import type { SelectQueryBuilder } from 'kysely';
import type { SchemaDef, SupportedProviders } from '../../../schema/schema';
import { PostgresQueryDialect } from './postgres';
import { SqliteQueryDialect } from './sqlite';

export interface QueryDialect {
    buildRelationSelection(
        query: SelectQueryBuilder<any, any, {}>,
        schema: SchemaDef,
        model: string,
        relationField: string,
        parentName: string,
        _payload: any
    ): SelectQueryBuilder<any, any, {}>;
}

const dialects: Record<SupportedProviders, QueryDialect> = {
    postgresql: new PostgresQueryDialect(),
    sqlite: new SqliteQueryDialect(),
};

export function getQueryDialect(provider: SupportedProviders) {
    return dialects[provider];
}
