import type { CacheInvalidationOptions, CacheProvider, CacheQueryResultEntry } from '../types';
import { entryIsExpired } from '../utils';

export class MemoryCache implements CacheProvider {
    private readonly queryResultStore: Map<string, CacheQueryResultEntry>
    
    // TODO: tags store

    constructor() {
        this.queryResultStore = new Map<string, CacheQueryResultEntry>();
        
        setInterval(() => {
            this.checkExpiration();
        }, 60000).unref();
    }

    private checkExpiration() {
        for (const [key, entry] of this.queryResultStore.entries()) {
            if (entryIsExpired(entry)) {
                this.delete(key);
            }
        }
    }

    getQueryResult(key: string) {
        return Promise.resolve(this.queryResultStore.get(key));
    }

    setQueryResult(key: string, entry: CacheQueryResultEntry) {
        this.queryResultStore.set(key, entry);
        return Promise.resolve();
    }

    delete(key: string) {
        return Promise.resolve(this.queryResultStore.delete(key));
    }

    invalidate(_options: CacheInvalidationOptions) {
        return Promise.resolve();
    }

    invalidateAll() {
        this.queryResultStore.clear();
        return Promise.resolve();
    }
}