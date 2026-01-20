import type { CacheInvalidationOptions, CacheProvider, CacheQueryResultEntry } from '../types';
import { entryIsExpired } from '../utils';

export class MemoryCache implements CacheProvider {
    private readonly queryResultStore: Map<string, CacheQueryResultEntry>;
    private readonly tagStore: Map<string, Set<string>>;

    constructor(private readonly options?: MemoryCacheOptions) {
        this.queryResultStore = new Map<string, CacheQueryResultEntry>();
        this.tagStore = new Map<string, Set<string>>;

        setInterval(() => {
            this.checkExpiration();
        }, this.options?.checkInterval ?? 60000).unref();
    }

    private checkExpiration() {
        for (const [key, entry] of this.queryResultStore.entries()) {
            if (entryIsExpired(entry)) {
                this.delete(key);
            }
        }

        for (const [tag, queryKeys] of this.tagStore.entries()) {
            for (const queryKey of queryKeys) {
                if (!this.queryResultStore.has(queryKey)) {
                    queryKeys.delete(queryKey);
                }
            }

            if (queryKeys.size === 0) {
                this.tagStore.delete(tag);
            }
        }
    }

    getQueryResult(key: string) {
        return Promise.resolve(this.queryResultStore.get(key));
    }

    setQueryResult(key: string, entry: CacheQueryResultEntry) {
        this.queryResultStore.set(key, entry);

        if (entry.options.tags) {
            for (const tag of entry.options.tags) {
                let queryKeys = this.tagStore.get(tag);

                if (!queryKeys) {
                    queryKeys = new Set<string>();
                    this.tagStore.set(tag, queryKeys);
                }

                queryKeys.add(key);
            }
        }

        return Promise.resolve();
    }

    delete(key: string) {
        return Promise.resolve(this.queryResultStore.delete(key));
    }

    invalidate(options: CacheInvalidationOptions) {
        if (options.tags) {
            for (const tag of options.tags) {
                const queryKeys = this.tagStore.get(tag);

                if (queryKeys) {
                    for (const queryKey of queryKeys) {
                        this.queryResultStore.delete(queryKey);
                    }
                }
            }
        }

        return Promise.resolve();
    }

    invalidateAll() {
        this.queryResultStore.clear();
        this.tagStore.clear();
        return Promise.resolve();
    }
}

export type MemoryCacheOptions = {
    checkInterval?: number;
};