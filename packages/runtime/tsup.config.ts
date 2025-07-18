import { defineConfig } from 'tsup';
import fs from 'node:fs';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        schema: 'src/schema/index.ts',
        helpers: 'src/helpers.ts',
        'plugins/policy/index': 'src/plugins/policy/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
    async onSuccess() {
        fs.cpSync('src/plugins/policy/plugin.zmodel', 'dist/plugins/policy/plugin.zmodel');
    },
});
