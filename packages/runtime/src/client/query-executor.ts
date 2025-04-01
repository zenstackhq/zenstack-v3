import type {
    DeleteQueryBuilder,
    InsertQueryBuilder,
    Kysely,
    SelectQueryBuilder,
    UpdateQueryBuilder,
} from 'kysely';
import type { Client } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { CrudOperation } from './crud/crud-handler';
import { InternalError } from './errors';

export type QueryContext<Schema extends SchemaDef> = {
    /**
     * The ZenStack client that's invoking the plugin.
     */
    client: Client<Schema>;

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
        // if (this.queryContext.client.$options.plugins) {
        //     for (const plugin of this.queryContext.client.$options.plugins) {
        //         if (
        //             plugin.transformKyselyQuery ||
        //             plugin.transformKyselyResult
        //         ) {
        //             const context = this.queryContext;
        //             const kyselyPlugin: KyselyPlugin = {
        //                 transformQuery(args) {
        //                     return plugin.transformKyselyQuery
        //                         ? plugin.transformKyselyQuery({
        //                               node: args.node,
        //                               ...context,
        //                           })
        //                         : args.node;
        //                 },
        //                 transformResult(args) {
        //                     return plugin.transformKyselyResult
        //                         ? plugin.transformKyselyResult({
        //                               ...args,
        //                               ...context,
        //                           })
        //                         : Promise.resolve(args.result);
        //                 },
        //             };
        //             kysely = kysely.withPlugin(kyselyPlugin);
        //             query = query.withPlugin(kyselyPlugin);
        //         }
        //     }
        // }

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
