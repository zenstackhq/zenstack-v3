import { zenstackAdapter } from '../src/adapter';
import { betterAuth } from 'better-auth';

export const auth = betterAuth({
    database: zenstackAdapter({} as any, {
        provider: 'postgresql',
    }),
    user: {
        additionalFields: {
            role: {
                type: ['user', 'admin'],
                required: false,
                defaultValue: 'user',
                input: false, // don't allow user to set role
            },
            lang: {
                type: 'string',
                required: false,
                defaultValue: 'en',
            },
            age: {
                type: 'number',
                required: true,
                defaultValue: 18,
            },
            admin: {
                type: 'boolean',
                required: false,
                defaultValue: false,
            },
        },
    },
});
