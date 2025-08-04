import type { DatabaseConnection, QueryResult } from 'kysely';
import type { BindParams, Database } from 'sql.js';

import { CompiledQuery } from 'kysely';

export class SqlJsConnection implements DatabaseConnection {
    private database: Database;

    constructor(database: Database) {
        this.database = database;
    }

    async executeQuery<R>(compiledQuery: CompiledQuery<unknown>): Promise<QueryResult<R>> {
        const executeResult = this.database.exec(compiledQuery.sql, compiledQuery.parameters as BindParams);
        const rowsModified = this.database.getRowsModified();
        return {
            numAffectedRows: BigInt(rowsModified),
            rows: executeResult
                .map(({ columns, values }) =>
                    values.map((row) => columns.reduce((acc, column, i) => ({ ...acc, [column]: row[i] }), {}) as R),
                )
                .flat(),
        };
    }

    // eslint-disable-next-line require-yield
    async *streamQuery() {
        throw new Error('Not supported with SQLite');
    }
}
