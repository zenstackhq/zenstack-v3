import type { LogEvent } from 'kysely';
import { getSchema, schema } from '../schemas/basic';
import { makePostgresClient, makeSqliteClient } from '../utils';
import type { ClientContract } from '../../src';

export function createClientSpecs(dbName: string, logQueries = false, providers: string[] = ['sqlite', 'postgresql']) {
    const logger = (provider: string) => (event: LogEvent) => {
        if (event.level === 'query') {
            console.log(`query(${provider}):`, event.query.sql, event.query.parameters);
        }
    };
    return [
        ...(providers.includes('sqlite')
            ? [
                  {
                      provider: 'sqlite' as const,
                      schema: getSchema('sqlite'),
                      createClient: async (): Promise<ClientContract<typeof schema>> => {
                          // tsc perf
                          return makeSqliteClient<any>(getSchema('sqlite'), {
                              log: logQueries ? logger('sqlite') : undefined,
                          }) as unknown as ClientContract<typeof schema>;
                      },
                  },
              ]
            : []),
        ...(providers.includes('postgresql')
            ? [
                  {
                      provider: 'postgresql' as const,
                      schema: getSchema('postgresql'),
                      createClient: async (): Promise<ClientContract<typeof schema>> => {
                          // tsc perf
                          return makePostgresClient<any>(getSchema('postgresql'), dbName, {
                              log: logQueries ? logger('postgresql') : undefined,
                          }) as unknown as ClientContract<typeof schema>;
                      },
                  },
              ]
            : []),
    ] as const;
}
