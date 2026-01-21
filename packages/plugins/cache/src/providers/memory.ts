import type { CacheInvalidationOptions, CacheProvider, CacheEntry } from '../types';
import { entryIsExpired } from '../utils';

export class MemoryCacheProvider implements CacheProvider {
    private readonly entryStore: Map<string, CacheEntry>;
    private readonly tagStore: Map<string, Set<string>>;

    constructor(private readonly options?: MemoryCacheOptions) {
        this.entryStore = new Map<string, CacheEntry>();
        this.tagStore = new Map<string, Set<string>>;

        setInterval(() => {
            this.checkExpiration();
        }, (this.options?.checkInterval ?? 60) * 1000).unref();
    }

    private checkExpiration() {
        for (const [key, entry] of this.entryStore) {
            if (entryIsExpired(entry)) {
                this.entryStore.delete(key);
            }
        }

        for (const [tag, keys] of this.tagStore) {
            for (const key of keys) {
                if (!this.entryStore.has(key)) {
                    keys.delete(key);
                }
            }

            if (keys.size === 0) {
                this.tagStore.delete(tag);
            }
        }
    }

    get(key: string) {
        return Promise.resolve(this.entryStore.get(key));
    }

    set(key: string, entry: CacheEntry) {
        this.entryStore.set(key, entry);

        if (entry.options.tags) {
            for (const tag of entry.options.tags) {
                let keys = this.tagStore.get(tag);

                if (!keys) {
                    keys = new Set<string>();
                    this.tagStore.set(tag, keys);
                }

                keys.add(key);
            }
        }

        return Promise.resolve();
    }

    invalidate(options: CacheInvalidationOptions) {
        if (options.tags) {
            for (const tag of options.tags) {
                const keys = this.tagStore.get(tag);

                if (keys) {
                    for (const key of keys) {
                        this.entryStore.delete(key);
                    }
                }
            }
        }

        return Promise.resolve();
    }

    invalidateAll() {
        this.entryStore.clear();
        this.tagStore.clear();
        return Promise.resolve();
    }
}

export type MemoryCacheOptions = {
    /**
     * How often, in seconds, entries will be checked for expiration.
     * 
     * @default 60
     */
    checkInterval?: number;
};