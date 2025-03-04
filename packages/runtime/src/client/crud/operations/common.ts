import { z, type ZodSchema } from 'zod';

export function orArray(schema: ZodSchema, canBeArray: boolean) {
    return canBeArray ? z.union([schema, z.array(schema)]) : schema;
}
