import type { SchemaDef } from '@zenstackhq/schema';
import { log, type Logger } from './logging';
import { applyMutation } from './mutator';
import type { ORMWriteActionType, QueryInfo } from './types';

/**
 * Custom optimistic data provider. It takes query information (usually fetched from query cache)
 * and returns a verdict on how to optimistically update the query data.
 *
 * @param args Arguments.
 * @param args.queryModel The model of the query.
 * @param args.queryOperation The operation of the query, `findMany`, `count`, etc.
 * @param args.queryArgs The arguments of the query.
 * @param args.currentData The current cache data for the query.
 * @param args.mutationArgs The arguments of the mutation.
 */
export type OptimisticDataProvider = (args: {
    queryModel: string;
    queryOperation: string;
    queryArgs: any;
    currentData: any;
    mutationArgs: any;
}) => OptimisticDataProviderResult | Promise<OptimisticDataProviderResult>;

/**
 * Result of optimistic data provider.
 */
export type OptimisticDataProviderResult = {
    /**
     * Kind of the result.
     *   - Update: use the `data` field to update the query cache.
     *   - Skip: skip the optimistic update for this query.
     *   - ProceedDefault: proceed with the default optimistic update.
     */
    kind: 'Update' | 'Skip' | 'ProceedDefault';

    /**
     * Data to update the query cache. Only applicable if `kind` is 'Update'.
     *
     * If the data is an object with fields updated, it should have a `$optimistic`
     * field set to `true`. If it's an array and an element object is created or updated,
     * the element should have a `$optimistic` field set to `true`.
     */
    data?: any;
};

/**
 * Options for optimistic update.
 */
export type OptimisticUpdateOptions = {
    /**
     * A custom optimistic data provider.
     */
    optimisticDataProvider?: OptimisticDataProvider;
};

/**
 * Creates a function that performs optimistic updates for queries potentially
 * affected by the given mutation operation.
 *
 * @param model Model under mutation.
 * @param operation Mutation operation (e.g, `update`).
 * @param schema The schema.
 * @param options Optimistic update options.
 * @param getAllQueries Callback to get all cached queries.
 * @param logging Logging option.
 */
export function createOptimisticUpdater(
    model: string,
    operation: string,
    schema: SchemaDef,
    options: OptimisticUpdateOptions,
    getAllQueries: () => readonly QueryInfo[],
    logging: Logger | undefined,
) {
    return async (...args: unknown[]) => {
        const [mutationArgs] = args;

        for (const queryInfo of getAllQueries()) {
            const logInfo = JSON.stringify({
                model: queryInfo.model,
                operation: queryInfo.operation,
                args: queryInfo.args,
            });

            if (!queryInfo.optimisticUpdate) {
                if (logging) {
                    log(logging, `Skipping optimistic update for ${logInfo} due to opt-out`);
                }
                continue;
            }

            if (options.optimisticDataProvider) {
                const providerResult = await options.optimisticDataProvider({
                    queryModel: queryInfo.model,
                    queryOperation: queryInfo.operation,
                    queryArgs: queryInfo.args,
                    currentData: queryInfo.data,
                    mutationArgs,
                });

                if (providerResult?.kind === 'Skip') {
                    // skip
                    if (logging) {
                        log(logging, `Skipping optimistic updating due to provider result: ${logInfo}`);
                    }
                    continue;
                } else if (providerResult?.kind === 'Update') {
                    // update cache
                    if (logging) {
                        log(logging, `Optimistically updating due to provider result: ${logInfo}`);
                    }
                    queryInfo.updateData(providerResult.data, true);
                    continue;
                }
            }

            // proceed with default optimistic update
            const mutatedData = await applyMutation(
                queryInfo.model,
                queryInfo.operation,
                queryInfo.data,
                model,
                operation as ORMWriteActionType,
                mutationArgs,
                schema,
                logging,
            );

            if (mutatedData !== undefined) {
                // mutation applicable to this query, update cache
                if (logging) {
                    log(logging, `Optimistically updating due to mutation "${model}.${operation}": ${logInfo}`);
                }
                queryInfo.updateData(mutatedData, true);
            }
        }
    };
}
