export function handleSubProcessError(err: unknown) {
    if (
        err instanceof Error &&
        'status' in err &&
        typeof err.status === 'number'
    ) {
        process.exit(err.status);
    } else {
        process.exit(1);
    }
}
