/**
 * Extracts database error code from an error thrown by the database driver.
 *
 * @todo currently assumes the error has a code field
 */
export function getDbErrorCode(error: unknown): unknown | undefined {
    if (error instanceof Error && 'code' in error) {
        return error.code;
    } else {
        return undefined;
    }
}
