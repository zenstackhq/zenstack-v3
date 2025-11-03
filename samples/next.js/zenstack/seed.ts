import { ZenStackClient } from '@zenstackhq/orm';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { schema } from './schema';

async function main() {
    const db = new ZenStackClient(schema, {
        dialect: new SqliteDialect({
            database: new SQLite('./zenstack/dev.db'),
        }),
    });

    await db.user.deleteMany();

    await db.user.createMany({
        data: [
            { id: '1', name: 'Alice', email: 'alice@example.com' },
            { id: '2', name: 'Bob', email: 'bob@example.com' },
        ],
    });
}

main();
