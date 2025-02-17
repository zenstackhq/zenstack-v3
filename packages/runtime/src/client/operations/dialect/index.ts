import type { SelectQueryBuilder } from 'kysely';
import type {
    BuiltinType,
    DataSourceProvider,
    SchemaDef,
} from '../../../schema/schema';
import type { OperationContext } from '../context';
import { PostgresQueryDialect } from './postgres';
import { SqliteQueryDialect } from './sqlite';

export interface QueryDialect {
    transformPrimitive(value: unknown, type: BuiltinType): any;

    buildRelationSelection<Schema extends SchemaDef>(
        context: OperationContext<Schema>,
        query: SelectQueryBuilder<any, any, {}>,
        relationField: string,
        parentName: string,
        payload: any
    ): SelectQueryBuilder<any, any, {}>;
}

const dialects: Record<DataSourceProvider, QueryDialect> = {
    postgresql: new PostgresQueryDialect(),
    sqlite: new SqliteQueryDialect(),
};

export function getQueryDialect(provider: DataSourceProvider) {
    return dialects[provider];
}
