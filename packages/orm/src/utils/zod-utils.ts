import { ZodError } from 'zod';
import { fromError as fromError3 } from 'zod-validation-error/v3';
import { fromError as fromError4 } from 'zod-validation-error/v4';

/**
 * Format ZodError into a readable string
 */
export function formatError(error: ZodError): string {
    if ('_zod' in error) {
        return fromError4(error).toString();
    } else {
        return fromError3(error).toString();
    }
}
