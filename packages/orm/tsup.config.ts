import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        schema: 'src/schema.ts',
        helpers: 'src/helpers.ts',
        'dialects/sqlite': 'src/dialects/sqlite.ts',
        'dialects/postgres': 'src/dialects/postgres.ts',
        'dialects/sql.js': 'src/dialects/sql.js/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
});
