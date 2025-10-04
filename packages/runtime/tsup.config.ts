import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
            schema: 'src/schema/index.ts',
            helpers: 'src/helpers.ts',
        },
        outDir: 'dist',
        splitting: false,
        sourcemap: true,
        clean: true,
        dts: true,
        format: ['cjs', 'esm'],
    },
    {
        // TODO: this approach externalizes JS imports but still duplicates type declarations
        entry: {
            'plugins/policy/index': 'src/plugins/policy/index.ts',
        },
        outDir: 'dist',
        splitting: false,
        sourcemap: true,
        esbuildPlugins: [
            {
                name: 'external-relative',
                setup(build) {
                    // "../../client/*" is resolved to "../../" after bundling
                    build.onResolve({ filter: /^\.\.\/\.\.\/client.*/ }, () => ({ path: '../../', external: true }));
                    // "../../schema/*" is resolved to "../../schema" after bundling
                    build.onResolve({ filter: /^\.\.\/\.\.\/schema.*/ }, () => ({
                        path: '../../schema',
                        external: true,
                    }));
                },
            },
        ],
        format: ['cjs', 'esm'],
    },
]);
