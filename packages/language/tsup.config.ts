import { defineConfig } from 'tsup';
import fs from 'node:fs';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        ast: 'src/ast.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['esm'],
    async onSuccess() {
        fs.cpSync('./res', './dist/res', { recursive: true });
    },
});
