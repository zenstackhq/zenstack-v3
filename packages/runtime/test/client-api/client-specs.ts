import type { LogEvent } from 'kysely';
import { getSchema } from '../test-schema';
import { makePostgresClient, makeSqliteClient } from '../utils';

export function createClientSpecs(dbName: string, logQueries = false) {
    const logger = (provider: string) => (event: LogEvent) => {
        if (event.level === 'query') {
            console.log(
                `query(${provider}):`,
                event.query.sql,
                event.query.parameters
            );
        }
    };
    return [
        {
            provider: 'sqlite' as const,
            makeClient: async () =>
                makeSqliteClient(getSchema('sqlite'), {
                    log: logQueries ? logger('sqlite') : undefined,
                }),
        },
        {
            provider: 'postgresql' as const,
            makeClient: async () =>
                makePostgresClient(getSchema('postgresql'), dbName, {
                    log: logQueries ? logger('postgresql') : undefined,
                }),
        },
    ] as const;
}
