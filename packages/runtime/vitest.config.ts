import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true,
        },
        include: ['**/*.test.ts'],
        setupFiles: ['./test/vitest-ext.ts'],
        testTimeout: 100000,
        hookTimeout: 100000,
    },
});
