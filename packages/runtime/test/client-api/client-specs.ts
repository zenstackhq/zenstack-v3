import type { LogEvent } from 'kysely';
import { getSchema, schema } from '../test-schema';
import { makePostgresClient, makeSqliteClient } from '../utils';
import type { Client } from '../../src/client';

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
            schema: getSchema('sqlite'),
            createClient: async () =>
                makeSqliteClient(getSchema('sqlite'), {
                    log: logQueries ? logger('sqlite') : undefined,
                }) as Promise<Client<typeof schema>>,
        },
        {
            provider: 'postgresql' as const,
            schema: getSchema('postgresql'),
            createClient: async () =>
                makePostgresClient(getSchema('postgresql'), dbName, {
                    log: logQueries ? logger('postgresql') : undefined,
                }) as unknown as Promise<Client<typeof schema>>,
        },
    ] as const;
}
