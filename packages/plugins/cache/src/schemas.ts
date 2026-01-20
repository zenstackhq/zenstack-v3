import z from 'zod';

export const cacheOptionsSchema = z.strictObject({
    ttl: z.number().min(1).optional(),
    swr: z.number().min(1).optional(),
});

export const cacheEnvelopeSchema = z.object({
    cache: cacheOptionsSchema.optional(),
});
