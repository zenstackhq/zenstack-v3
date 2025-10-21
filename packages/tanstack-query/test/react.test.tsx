import { describe, expect, it } from 'vitest';
import { Provider } from '../src/runtime/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, vi } from 'vitest';
import { useModelMutation, useModelQuery } from '../src/react';
import { schema } from './schema';

const ENDPOINT_MOCK = 'http://localhost:3000';

afterEach(() => {
    cleanup();
});

const mockFetch = vi.fn(function (url: string, options: RequestInit) {
    return Response.json({
        url,
        options,
    });
});

const queryClient = new QueryClient();

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider
            client={queryClient}
        >
            <Provider value={{
                endpoint: ENDPOINT_MOCK,
                fetch: mockFetch as any,
            }}
            >
                {children}
            </Provider>
        </QueryClientProvider>
    );
}

describe('useModelQuery', () => {
    it('should be able to findFirst', async () => {
        const { result } = renderHook(() => (
            useModelQuery(schema, 'User', 'findFirst')
        ), {
            wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockFetch).toHaveBeenCalledWith(ENDPOINT_MOCK);
    });
});

describe('useModelMutation', () => {
    it('should be able to create', async () => {
        const { result } = renderHook(() => (
            useModelMutation(schema, 'User', 'create', 'POST')
        ), {
            wrapper,
        });

        await waitFor(() => result.current.mutateAsync());

        expect(mockFetch).toHaveBeenCalledWith(ENDPOINT_MOCK, {
            method: 'POST',
        });
    });
});