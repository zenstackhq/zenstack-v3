import { schema } from '@/zenstack/schema';
import { ZenStackClient } from '@zenstackhq/orm';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';

export const db = new ZenStackClient(schema, {
    dialect: new SqliteDialect({
        database: new SQLite('./zenstack/dev.db'),
    }),
});
