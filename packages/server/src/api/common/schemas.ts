import z from 'zod';

export const loggerSchema = z.union([z.enum(['debug', 'info', 'warn', 'error']).array(), z.function()]);
