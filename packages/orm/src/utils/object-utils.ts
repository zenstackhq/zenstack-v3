/**
 * Extract fields from an object.
 */
export function extractFields(obj: any, fields: readonly string[]) {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => fields.includes(key)));
}

/**
 * Create an object with fields as keys and true values.
 */
export function fieldsToSelectObject(fields: readonly string[]): Record<string, boolean> {
    return Object.fromEntries(fields.map((f) => [f, true]));
}
