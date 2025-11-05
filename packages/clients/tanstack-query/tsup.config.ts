import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        react: 'src/react.ts',
        vue: 'src/vue.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
});
