import { describe, expect, it, vi } from 'vitest';
import { sleep } from '../src/sleep';

describe('sleep tests', () => {
    it('should resolve after the specified timeout', async () => {
        const start = Date.now();
        await sleep(100);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(95); // Allow for small timing variations
    });

    it('should resolve immediately for zero timeout', async () => {
        const start = Date.now();
        await sleep(0);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(50); // Should be nearly instant
    });

    it('should return a Promise', () => {
        const result = sleep(10);
        expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve to undefined', async () => {
        const result = await sleep(10);
        expect(result).toBeUndefined();
    });

    it('should work with multiple concurrent sleeps', async () => {
        const start = Date.now();
        await Promise.all([sleep(50), sleep(50), sleep(50)]);
        const elapsed = Date.now() - start;
        // All should run concurrently, so total time should be ~50ms, not 150ms
        expect(elapsed).toBeLessThan(100);
    });

    it('should work in a chain', async () => {
        const start = Date.now();
        await sleep(50).then(() => sleep(50));
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(95); // Should be ~100ms total
    });

    it('should allow using with async/await', async () => {
        const order: number[] = [];
        order.push(1);
        await sleep(50);
        order.push(2);
        expect(order).toEqual([1, 2]);
    });

    it('should work with setTimeout mock', async () => {
        vi.useFakeTimers();
        const promise = sleep(1000);
        vi.advanceTimersByTime(1000);
        await promise;
        vi.useRealTimers();
    });

    it('should handle very short timeouts', async () => {
        await expect(sleep(1)).resolves.toBeUndefined();
    });

    it('should handle longer timeouts', async () => {
        const start = Date.now();
        await sleep(200);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(190);
    });
});
