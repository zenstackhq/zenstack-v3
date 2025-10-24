import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        api: 'src/api/index.ts',
        express: 'src/express/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
});
