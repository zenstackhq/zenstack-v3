import { execSync as _exec, type ExecSyncOptions } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Utility for executing command synchronously and prints outputs on current console
 */
export function execSync(cmd: string, options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> }): void {
    const { env, ...restOptions } = options ?? {};
    const mergedEnv = env ? { ...process.env, ...env } : undefined;
    _exec(cmd, {
        encoding: 'utf-8',
        stdio: options?.stdio ?? 'inherit',
        env: mergedEnv,
        ...restOptions,
    });
}

/**
 * Run a package-manager command using `bunx` when running on Bun, otherwise `npx`.
 *
 * @param cmd - The package command and its arguments (e.g. `"install foo"` or `"run build"`).
 * @param options - Additional child_process.execSync options; `env` may be provided to override or extend the environment. 
 */
export function execPackage(
    cmd: string,
    options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> },
): void {
    const packageManager = process?.versions?.['bun'] ? 'bunx' : 'npx';
    execSync(`${packageManager} ${cmd}`, options);
}

/**
 * Execute the Prisma CLI with the provided command-line arguments.
 *
 * Resolves the installed Prisma binary and runs it via `node` with the given `args`.
 *
 * @param args - Command-line arguments to pass to the Prisma CLI (e.g., `"migrate deploy"`).
 * @param options - Options forwarded to the underlying `execSync`. If `options.env` is provided, its entries are merged with `process.env`.
 */
export function execPrisma(args: string, options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> }) {
    let prismaPath: string;
    if (typeof import.meta.resolve === 'function') {
        // esm
        prismaPath = fileURLToPath(import.meta.resolve('prisma/build/index.js'));
    } else {
        // cjs
        prismaPath = require.resolve('prisma/build/index.js');
    }
    execSync(`node ${prismaPath} ${args}`, options);
}