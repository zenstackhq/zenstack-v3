import type { PostgresDialectConfig } from 'kysely';
import { Pool } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';

/**
 * Convert a PostgreSQL connection string to a Kysely dialect config.
 */
export function toDialectConfig(url: string): PostgresDialectConfig {
    return {
        pool: new Pool(parseIntoClientConfig(url)),
    };
}
