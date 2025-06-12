import type {
    CompiledQuery,
    DatabaseConnection,
    Driver,
    Log,
    QueryResult,
    TransactionSettings,
} from 'kysely';

/**
 * Copied from kysely's RuntimeDriver
 */
export class ZenStackDriver implements Driver {
    readonly #driver: Driver;
    readonly #log: Log;
    txConnection: DatabaseConnection | undefined;

    #initPromise?: Promise<void>;
    #initDone: boolean;
    #destroyPromise?: Promise<void>;
    #connections = new WeakSet<DatabaseConnection>();

    constructor(driver: Driver, log: Log) {
        this.#initDone = false;
        this.#driver = driver;
        this.#log = log;
    }

    async init(): Promise<void> {
        if (this.#destroyPromise) {
            throw new Error('driver has already been destroyed');
        }

        if (!this.#initPromise) {
            this.#initPromise = this.#driver
                .init()
                .then(() => {
                    this.#initDone = true;
                })
                .catch((err) => {
                    this.#initPromise = undefined;
                    return Promise.reject(err);
                });
        }

        await this.#initPromise;
    }

    async acquireConnection(): Promise<DatabaseConnection> {
        if (this.#destroyPromise) {
            throw new Error('driver has already been destroyed');
        }

        if (!this.#initDone) {
            await this.init();
        }

        const connection = await this.#driver.acquireConnection();

        if (!this.#connections.has(connection)) {
            if (this.#needsLogging()) {
                this.#addLogging(connection);
            }

            this.#connections.add(connection);
        }

        return connection;
    }

    async releaseConnection(connection: DatabaseConnection): Promise<void> {
        await this.#driver.releaseConnection(connection);
    }

    async beginTransaction(
        connection: DatabaseConnection,
        settings: TransactionSettings
    ): Promise<void> {
        const result = await this.#driver.beginTransaction(
            connection,
            settings
        );
        this.txConnection = connection;
        return result;
    }

    commitTransaction(connection: DatabaseConnection): Promise<void> {
        try {
            return this.#driver.commitTransaction(connection);
        } finally {
            this.txConnection = undefined;
        }
    }

    rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        try {
            return this.#driver.rollbackTransaction(connection);
        } finally {
            this.txConnection = undefined;
        }
    }

    async destroy(): Promise<void> {
        if (!this.#initPromise) {
            return;
        }

        await this.#initPromise;

        if (!this.#destroyPromise) {
            this.#destroyPromise = this.#driver.destroy().catch((err) => {
                this.#destroyPromise = undefined;
                return Promise.reject(err);
            });
        }

        await this.#destroyPromise;
    }

    #needsLogging(): boolean {
        return (
            this.#log.isLevelEnabled('query') ||
            this.#log.isLevelEnabled('error')
        );
    }

    // This method monkey patches the database connection's executeQuery method
    // by adding logging code around it. Monkey patching is not pretty, but it's
    // the best option in this case.
    #addLogging(connection: DatabaseConnection): void {
        const executeQuery = connection.executeQuery;
        const streamQuery = connection.streamQuery;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const dis = this;

        connection.executeQuery = async (
            compiledQuery
        ): Promise<QueryResult<any>> => {
            let caughtError: unknown;
            const startTime = performanceNow();

            try {
                return await executeQuery.call(connection, compiledQuery);
            } catch (error) {
                caughtError = error;
                await dis.#logError(error, compiledQuery, startTime);
                throw error;
            } finally {
                if (!caughtError) {
                    await dis.#logQuery(compiledQuery, startTime);
                }
            }
        };

        connection.streamQuery = async function* (
            compiledQuery,
            chunkSize
        ): AsyncIterableIterator<QueryResult<any>> {
            let caughtError: unknown;
            const startTime = performanceNow();

            try {
                for await (const result of streamQuery.call(
                    connection,
                    compiledQuery,
                    chunkSize
                )) {
                    yield result;
                }
            } catch (error) {
                caughtError = error;
                await dis.#logError(error, compiledQuery, startTime);
                throw error;
            } finally {
                if (!caughtError) {
                    await dis.#logQuery(compiledQuery, startTime, true);
                }
            }
        };
    }

    async #logError(
        error: unknown,
        compiledQuery: CompiledQuery,
        startTime: number
    ): Promise<void> {
        await this.#log.error(() => ({
            level: 'error',
            error,
            query: compiledQuery,
            queryDurationMillis: this.#calculateDurationMillis(startTime),
        }));
    }

    async #logQuery(
        compiledQuery: CompiledQuery,
        startTime: number,
        isStream = false
    ): Promise<void> {
        await this.#log.query(() => ({
            level: 'query',
            isStream,
            query: compiledQuery,
            queryDurationMillis: this.#calculateDurationMillis(startTime),
        }));
    }

    #calculateDurationMillis(startTime: number): number {
        return performanceNow() - startTime;
    }
}

export function performanceNow() {
    if (
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
    ) {
        return performance.now();
    } else {
        return Date.now();
    }
}
