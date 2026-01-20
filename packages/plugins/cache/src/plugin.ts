import { lowerCaseFirst } from '@zenstackhq/common-helpers';
import { definePlugin } from '@zenstackhq/orm';
import stableStringify from 'json-stable-stringify';
import murmurhash from 'murmurhash';
import { cacheEnvelopeSchema } from './schemas';
import type { CacheEnvelope, CacheInvalidationOptions, CachePluginOptions } from './types';

export function defineCachePlugin(pluginOptions: CachePluginOptions) {
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
                    return queryResultEntry.result;
                }

                const result = await proceed(args);

                cache.setQueryResult(key, {
                    createdAt: Date.now(),
                    options,
                    result,
                }).catch((err) => console.error(`Failed to cache query result: ${err}`));

                return result;
            }

            return proceed(args);
        },
    });
}