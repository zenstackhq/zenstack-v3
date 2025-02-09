import { getSchema } from '../test-schema';
import { makePostgresClient, makeSqliteClient } from '../utils';

export function createClientSpecs(dbName: string) {
    return [
        {
            provider: 'sqlite' as const,
            makeClient: async () => makeSqliteClient(getSchema('sqlite')),
        },
        {
            provider: 'postgresql' as const,
            makeClient: async () =>
                makePostgresClient(getSchema('postgresql'), dbName),
        },
    ] as const;
}
