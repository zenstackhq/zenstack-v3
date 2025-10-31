import { ZodError } from 'zod';
import { fromError } from 'zod-validation-error/v4';

/**
 * Format ZodError into a readable string
 */
export function formatError(error: ZodError): string {
    return fromError(error).toString();
}
