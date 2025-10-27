import { Decimal } from 'decimal.js';
import SuperJSON from 'superjson';
import { match } from 'ts-pattern';
import { ZodError } from 'zod';
import { fromError as fromError3 } from 'zod-validation-error/v3';
import { fromError as fromError4 } from 'zod-validation-error/v4';
import type { LogConfig, LogLevel } from '../types';

export function log(logger: LogConfig | undefined, level: LogLevel, message: string | (() => string), error?: unknown) {
    if (!logger) {
        return;
    }

    const getMessage = typeof message === 'function' ? message : () => message;

    if (typeof logger === 'function') {
        logger(level, getMessage(), error);
    } else if (logger.includes(level)) {
        const logFn = match(level)
            .with('debug', () => console.debug)
            .with('info', () => console.info)
            .with('warn', () => console.warn)
            .with('error', () => console.error)
            .exhaustive();
        logFn(`@zenstackhq/server: [${level}] ${getMessage()}${error ? `\n${error}` : ''}`);
    }
}

/**
 * Registers custom superjson serializers.
 */
export function registerCustomSerializers() {
    SuperJSON.registerCustom<Decimal, string>(
        {
            isApplicable: (v): v is Decimal => Decimal.isDecimal(v),
            serialize: (v) => v.toJSON(),
            deserialize: (v) => new Decimal(v),
        },
        'Decimal',
    );

    // `Buffer` is not available in edge runtime
    if (globalThis.Buffer) {
        SuperJSON.registerCustom<Buffer, string>(
            {
                isApplicable: (v): v is Buffer => Buffer.isBuffer(v),
                serialize: (v) => v.toString('base64'),
                deserialize: (v) => Buffer.from(v, 'base64'),
            },
            'Bytes',
        );
    }
}

/**
 * Format ZodError into a readable string
 */
export function getZodErrorMessage(error: ZodError): string {
    if ('_zod' in error) {
        return fromError4(error).toString();
    } else {
        return fromError3(error).toString();
    }
}
