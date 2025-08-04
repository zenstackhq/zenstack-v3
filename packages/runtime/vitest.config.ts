import base from '@zenstackhq/vitest-config/base';
import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
    base,
    defineConfig({
        test: {
            setupFiles: [path.resolve(__dirname, './test/vitest-ext.ts')],
        },
    }),
);
