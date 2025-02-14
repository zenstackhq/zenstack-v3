import type { LogEvent } from 'kysely';
import { getSchema } from '../test-schema';
import { makePostgresClient, makeSqliteClient } from '../utils';

export function createClientSpecs(dbName: string, logQueries = false) {
    const logger = (event: LogEvent) => {
        if (event.level === 'query') {
            console.log('query:', event.query.sql, event.query.parameters);
        }
    };
    return [
        {
            provider: 'sqlite' as const,
            makeClient: async () =>
                makeSqliteClient(getSchema('sqlite'), {
                    log: logQueries ? logger : undefined,
                }),
        },
        {
            provider: 'postgresql' as const,
            makeClient: async () =>
                makePostgresClient(getSchema('postgresql'), dbName, {
                    log: logQueries ? logger : undefined,
                }),
        },
    ] as const;
}
