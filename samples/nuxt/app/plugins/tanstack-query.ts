import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { provideQuerySettingsContext } from '@zenstackhq/tanstack-query/vue';

export default defineNuxtPlugin((nuxtApp) => {
    const queryClient = new QueryClient();

    nuxtApp.vueApp.use(VueQueryPlugin, { queryClient });

    // Provide ZenStack query settings
    nuxtApp.vueApp.mixin({
        setup() {
            provideQuerySettingsContext({
                endpoint: '/api/model',
                logging: true,
            });
        },
    });
});
