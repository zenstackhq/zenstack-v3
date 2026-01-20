import type { CacheEntry } from './types';

export function getTotalTTL(entry: CacheEntry) {
    return (entry.options.ttl ?? 0) + (entry.options.swr ?? 0);
}

export function entryIsFresh(entry: CacheEntry) {
    return entry.options.ttl
        ? Date.now() <= (entry.createdAt + (entry.options.ttl ?? 0))
        : false;
}

export function entryIsStale(entry: CacheEntry) {
    return entry.options.swr
        ? Date.now() <= getTotalTTL(entry)
        : false;
}

export function entryIsExpired(entry: CacheEntry) {
    return Date.now() > getTotalTTL(entry);
}
