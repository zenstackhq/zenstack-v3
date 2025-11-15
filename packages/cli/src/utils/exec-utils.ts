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
 * Utility for running package commands through npx/bunx
 */
export function execPackage(
    cmd: string,
    options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> },
): void {
    const packageManager = process?.versions?.['bun'] ? 'bunx' : 'npx';
    execSync(`${packageManager} ${cmd}`, options);
}

/**
 * Utility for running prisma commands
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
