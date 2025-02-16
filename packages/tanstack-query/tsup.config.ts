import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        react: 'src/react.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
});
