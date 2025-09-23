import { defineConfig } from 'tsup';

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
});
