import SQLite from 'better-sqlite3';
import type { SqliteDialectConfig } from 'kysely';
import path from 'node:path';

/**
 * Convert a SQLite connection string to a Kysely dialect config.
 */
export function toDialectConfig(
    url: string,
    baseDir: string
): SqliteDialectConfig {
    if (url === ':memory:') {
        return {
            database: new SQLite(':memory:'),
        };
    }
    const filePath = path.resolve(baseDir, url);
    return {
        database: new SQLite(filePath),
    };
}
