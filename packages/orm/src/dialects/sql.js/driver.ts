import type { DatabaseConnection, Driver } from 'kysely';

import { CompiledQuery } from 'kysely';

import { SqlJsConnection } from './connection';
import type { SqlJsDialectConfig } from './types';

export class SqlJsDriver implements Driver {
    private config: SqlJsDialectConfig;

    constructor(config: SqlJsDialectConfig) {
        this.config = config;
    }

    async acquireConnection(): Promise<DatabaseConnection> {
        return new SqlJsConnection(this.config.sqlJs);
    }

    async beginTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('BEGIN'));
    }

    async commitTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('COMMIT'));
    }

    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
    }

    async destroy(): Promise<void> {
        this.config.sqlJs.close();
    }

    async init() {}

    async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}
