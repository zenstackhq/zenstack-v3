import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true,
        },
        include: ['**/*.test.ts'],
        testTimeout: 100000,
    },
});
