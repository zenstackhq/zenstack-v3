import type {
    DeleteQueryBuilder,
    InsertQueryBuilder,
    Kysely,
    SelectQueryBuilder,
    UpdateQueryBuilder,
} from 'kysely';
import type { ClientContract } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { CrudOperation } from './crud/operations/base';
import { InternalError } from './errors';

export type QueryContext<Schema extends SchemaDef> = {
    /**
     * The ZenStack client that's invoking the plugin.
     */
    client: ClientContract<Schema>;

    model: GetModels<Schema>;

    operation: CrudOperation;

    args: unknown;
};

type ExecutableQueries =
    | SelectQueryBuilder<any, any, any>
    | UpdateQueryBuilder<any, any, any, any>
    | InsertQueryBuilder<any, any, any>
    | DeleteQueryBuilder<any, any, any>;

export class QueryExecutor<Schema extends SchemaDef> {
    constructor(protected readonly queryContext: QueryContext<Schema>) {}

    async execute(kysely: Kysely<any>, query: ExecutableQueries) {
        return kysely.executeQuery(query.compile());
    }

    async executeGetRows(kysely: Kysely<any>, query: ExecutableQueries) {
        return (await this.execute(kysely, query)).rows;
    }

    async executeTakeFirst(kysely: Kysely<any>, query: ExecutableQueries) {
        const result = await this.execute(kysely, query);
        return result.rows[0];
    }

    async executeTakeFirstOrThrow(
        kysely: Kysely<any>,
        query: ExecutableQueries
    ) {
        const result = await this.execute(kysely, query);
        if (result.rows.length === 0) {
            throw new InternalError(
                `Query returned no results: ${query.compile().sql}`
            );
        }
        return result.rows[0];
    }
}
