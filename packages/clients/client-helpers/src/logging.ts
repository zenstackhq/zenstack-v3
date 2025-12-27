/**
 * Logger configuration. `true` enables console logging. A function can be provided for custom logging.
 */
export type Logger = boolean | ((message: string) => void);

/**
 * Logs a message using the provided logger.
 */
export function log(logger: Logger, message: string) {
    if (typeof logger === 'function') {
        logger(message);
    } else if (logger) {
        console.log(message);
    }
}
