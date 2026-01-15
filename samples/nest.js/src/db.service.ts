import { ClientOptions, ZenStackClient } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import SQLite from 'better-sqlite3';
import { schema, SchemaType } from './zenstack/schema';

export class DbService extends ZenStackClient<
  SchemaType,
  ClientOptions<SchemaType>
> {
  constructor() {
    super(schema, {
      dialect: new SqliteDialect({
        database: new SQLite('./src/zenstack/dev.db'),
      }),
      log: ['query', 'error'],
    });
  }
}
