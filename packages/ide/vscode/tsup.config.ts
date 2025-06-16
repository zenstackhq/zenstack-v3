import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        extension: 'src/extension/main.ts',
        'language-server': 'src/language-server/main.ts',
    },
    outDir: 'dist',
    splitting: false,
    clean: true,
    format: ['cjs'],
    noExternal: [/^(?!vscode$)/],
    external: ['vscode'],
});
