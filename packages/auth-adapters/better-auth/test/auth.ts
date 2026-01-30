import { zenstackAdapter } from '../src/adapter';
import { betterAuth } from 'better-auth';

export const auth = betterAuth({
    database: zenstackAdapter({} as any, {
        provider: 'postgresql',
    }),
});
