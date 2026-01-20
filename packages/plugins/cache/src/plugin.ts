import { lowerCaseFirst } from '@zenstackhq/common-helpers';
import { definePlugin } from '@zenstackhq/orm';
import stableStringify from 'json-stable-stringify';
import murmurhash from 'murmurhash';
import { cacheEnvelopeSchema } from './schemas';
import type { CacheEnvelope, CacheInvalidationOptions, CachePluginOptions, CacheStatus } from './types';
import { entryIsFresh, entryIsStale } from './utils'

export function defineCachePlugin(pluginOptions: CachePluginOptions) {
    let status: CacheStatus | null = null;
    let revalidation: Promise<void> | null = null;

    return definePlugin({
        id: 'cache',
        name: 'Cache',
        description: 'Optionally caches read queries.',

        queryArgs: {
            $read: cacheEnvelopeSchema,
        },

        client: {
            $cache: {
                invalidate: (options: CacheInvalidationOptions) => {
                    return pluginOptions.provider.invalidate(options);
                },

                invalidateAll() {
                    return pluginOptions.provider.invalidateAll();
                },

                /**
                 * Returns the status of the last result returned, or `null`
                 * if a result has yet to be returned.
                 */
                get status() {
                    return status;
                },

                /**
                 * Returns a `Promise` that fulfills when the last stale result
                 * returned has been revalidated, or `null` if a stale result has
                 * yet to be returned.
                 */
                get revalidation() {
                    return revalidation;
                }
            },
        },

        onQuery: async ({ args, model, operation, proceed }) => {
            if (args && 'cache' in args) {
                const json = stableStringify({
                    args,
                    model,
                    operation,
                });

                if (!json) {
                    throw new Error(`Failed to serialize cache entry for ${lowerCaseFirst(model)}.${operation}`);
                }

                const cache = pluginOptions.provider;
                const options = (args as CacheEnvelope).cache!;
                const key = murmurhash.v3(json).toString();
                const queryResultEntry = await cache.getQueryResult(key);

                if (queryResultEntry) {
                    if (entryIsFresh(queryResultEntry)) {
                        status = 'hit';
                        return queryResultEntry.result;
                    } else if (entryIsStale(queryResultEntry)) {
                        revalidation = proceed(args).then(async (result) => {
                            try {
                                await cache.setQueryResult(key, {
                                    createdAt: Date.now(),
                                    options,
                                    result,
                                })
                            }
                            catch (err) {
                                console.error(`Failed to cache query result: ${err}`)
                            }
                        });

                        status = 'stale';
                        return queryResultEntry.result;
                    }
                }

                const result = await proceed(args);

                cache.setQueryResult(key, {
                    createdAt: Date.now(),
                    options,
                    result,
                }).catch((err) => console.error(`Failed to cache query result: ${err}`));

                status = 'miss';
                return result;
            }

            return proceed(args);
        },
    });
}