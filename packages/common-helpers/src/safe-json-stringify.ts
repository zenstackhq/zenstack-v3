/**
 * A safe JSON stringify that handles bigint values.
 */
export function safeJSONStringify(value: unknown) {
    return JSON.stringify(value, (_, v) => {
        if (typeof v === 'bigint') {
            return v.toString();
        } else {
            return v;
        }
    });
}
