import fs from 'fs';
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    dts: true,
    format: ['cjs', 'esm'],
    async onSuccess() {
        fs.cpSync('src/types.d.ts', 'dist/types.d.ts', { force: true });
    },
});
