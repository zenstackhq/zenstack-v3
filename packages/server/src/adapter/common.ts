import type { SchemaDef } from '@zenstackhq/orm/schema';
import { log } from '../api/utils';
import type { ApiHandler, LogConfig } from '../types';

/**
 * Options common to all adapters
 */
export interface CommonAdapterOptions<Schema extends SchemaDef> {
    /**
     * The API handler to process requests
     */
    apiHandler: ApiHandler<Schema>;
}

export function logInternalError(logger: LogConfig | undefined, err: unknown) {
    log(
        logger,
        'error',
        `An unhandled error occurred while processing the request: ${err}${err instanceof Error ? '\n' + err.stack : ''}`,
    );
}
