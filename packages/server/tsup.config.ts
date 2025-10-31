import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        api: 'src/api/index.ts',
        express: 'src/adapter/express/index.ts',
        next: 'src/adapter/next/index.ts',
        fastify: 'src/adapter/fastify/index.ts',
        elysia: 'src/adapter/elysia/index.ts',
        nuxt: 'src/adapter/nuxt/index.ts',
        hono: 'src/adapter/hono/index.ts',
        sveltekit: 'src/adapter/sveltekit/index.ts',
        'tanstack-start': 'src/adapter/tanstack-start/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
});
