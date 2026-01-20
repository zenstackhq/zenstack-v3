import type { AllReadOperations } from '@zenstackhq/orm';
import type z from 'zod';
import type { cacheEnvelopeSchema, cacheOptionsSchema } from './schemas';

export type CacheEnvelope = z.infer<typeof cacheEnvelopeSchema>;
export type CacheOptions = z.infer<typeof cacheOptionsSchema>;

export interface CacheProvider {
    getQueryResult: (key: string) => Promise<CacheQueryResultEntry | undefined>;
    setQueryResult: (key: string, entry: CacheQueryResultEntry) => Promise<void>;
    invalidate: (options: CacheInvalidationOptions) => Promise<void>;
    invalidateAll: () => Promise<void>;
};

export type CacheInvalidationOptions = {
    tags?: [];
};

export type CachePluginQueryOptions = {
    [Op in AllReadOperations]: CacheEnvelope;
};

export type CacheEntry = {
    createdAt: number;
    options: CacheOptions;
}

export type CacheQueryResultEntry = CacheEntry & {
    result: unknown;
};

export type CachePluginOptions = {
    provider: CacheProvider;
};
