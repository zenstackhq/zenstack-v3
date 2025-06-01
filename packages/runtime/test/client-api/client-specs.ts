import type { LogEvent } from 'kysely';
import { getSchema, schema } from '../test-schema';
import { makePostgresClient, makeSqliteClient } from '../utils';
import type { ClientContract } from '../../src';

export function createClientSpecs(
    dbName: string,
    logQueries = false,
    providers = ['sqlite', 'postgresql'] as const
) {
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
        ...(providers.includes('sqlite')
            ? [
                  {
                      provider: 'sqlite' as const,
                      schema: getSchema('sqlite'),
                      createClient: async () => {
                          const client = await makeSqliteClient(
                              getSchema('sqlite'),
                              {
                                  log: logQueries
                                      ? logger('sqlite')
                                      : undefined,
                              }
                          );
                          return client as ClientContract<typeof schema>;
                      },
                  },
              ]
            : []),
        ...(providers.includes('postgresql')
            ? [
                  {
                      provider: 'postgresql' as const,
                      schema: getSchema('postgresql'),
                      createClient: async () => {
                          const client = await makePostgresClient(
                              getSchema('postgresql'),
                              dbName,
                              {
                                  log: logQueries
                                      ? logger('postgresql')
                                      : undefined,
                              }
                          );
                          return client as unknown as ClientContract<
                              typeof schema
                          >;
                      },
                  },
              ]
            : []),
    ] as const;
}
