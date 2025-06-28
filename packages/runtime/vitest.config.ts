import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.base.config';
import path from 'node:path';

export default mergeConfig(
    base,
    defineConfig({
        test: {
            setupFiles: [path.resolve(__dirname, './test/vitest-ext.ts')],
        },
    }),
);
