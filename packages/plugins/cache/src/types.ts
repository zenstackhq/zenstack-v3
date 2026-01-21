import type z from 'zod';
import type { cacheEnvelopeSchema, cacheOptionsSchema } from './schemas';

export type CacheEnvelope = z.infer<typeof cacheEnvelopeSchema>;
export type CacheOptions = z.infer<typeof cacheOptionsSchema>;

export interface CacheProvider {
    get: (key: string) => Promise<CacheEntry | undefined>;
    set: (key: string, entry: CacheEntry) => Promise<void>;
    invalidate: (options: CacheInvalidationOptions) => Promise<void>;
    invalidateAll: () => Promise<void>;
};

export type CacheInvalidationOptions = {
    tags?: string[];
};

export type CacheEntry = {
    /**
     * In unix epoch milliseconds.
     */
    createdAt: number;

    /**
     * The caching options that were passed to the query.
     */
    options: CacheOptions;

    /**
     * The result of executing the query.
     */
    result: unknown;
};

export type CachePluginOptions = {
    provider: CacheProvider;
};

export type CacheStatus = 'hit' | 'miss' | 'stale';