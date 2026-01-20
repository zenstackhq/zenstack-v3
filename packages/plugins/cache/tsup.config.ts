import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'providers/memory': 'src/providers/memory.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    dts: true,
    format: ['cjs', 'esm'],
});
