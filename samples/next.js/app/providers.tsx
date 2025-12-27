'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuerySettingsProvider } from '@zenstackhq/tanstack-query/react';
import type { ReactNode } from 'react';

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <QuerySettingsProvider value={{ endpoint: '/api/model', logging: true }}>{children}</QuerySettingsProvider>
        </QueryClientProvider>
    );
}
