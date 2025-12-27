import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logging';
import { createOptimisticUpdater } from '../src/optimistic';
import type { QueryInfo } from '../src/types';
import { createField, createRelationField, createSchema } from './test-helpers';

describe('Optimistic update tests', () => {
    describe('createOptimisticUpdater', () => {
        it('applies default optimistic update to matching queries', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [
                        { id: '1', name: 'John' },
                        { id: '2', name: 'Jane' },
                    ],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Should update the cache with the optimistic data
            expect(updateDataMock).toHaveBeenCalledTimes(1);
            const updatedData = updateDataMock.mock.calls[0]?.[0];
            expect(updatedData).toBeDefined();
            expect(Array.isArray(updatedData)).toBe(true);
        });

        it('skips queries with optimisticUpdate set to false', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: false, // opted out
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Should not update the cache
            expect(updateDataMock).not.toHaveBeenCalled();
        });

        it('uses custom optimisticDataProvider when provided', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const customData = [{ id: '1', name: 'Custom', $optimistic: true }];
            const optimisticDataProvider = vi.fn(() => ({
                kind: 'Update' as const,
                data: customData,
            }));

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Provider should be called
            expect(optimisticDataProvider).toHaveBeenCalledWith({
                queryModel: 'User',
                queryOperation: 'findMany',
                queryArgs: {},
                currentData: [{ id: '1', name: 'John' }],
                mutationArgs: { where: { id: '1' }, data: { name: 'Johnny' } },
            });

            // Should update with custom data
            expect(updateDataMock).toHaveBeenCalledWith(customData, true);
        });

        it('skips update when provider returns Skip', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const optimisticDataProvider = vi.fn(() => ({
                kind: 'Skip' as const,
            }));

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1' }],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            await updater({ where: { id: '1' }, data: {} });

            // Provider should be called
            expect(optimisticDataProvider).toHaveBeenCalled();

            // Should not update
            expect(updateDataMock).not.toHaveBeenCalled();
        });

        it('proceeds with default update when provider returns ProceedDefault', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const optimisticDataProvider = vi.fn(() => ({
                kind: 'ProceedDefault' as const,
            }));

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Provider should be called
            expect(optimisticDataProvider).toHaveBeenCalled();

            // Should proceed with default update
            expect(updateDataMock).toHaveBeenCalled();
        });

        it('handles async optimisticDataProvider', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const optimisticDataProvider = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    kind: 'Update' as const,
                    data: [{ id: '1', $optimistic: true }],
                };
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            await updater({ where: { id: '1' }, data: {} });

            expect(optimisticDataProvider).toHaveBeenCalled();
            expect(updateDataMock).toHaveBeenCalled();
        });

        it('processes multiple queries', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateData1 = vi.fn();
            const updateData2 = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: true,
                    updateData: updateData1,
                },
                {
                    model: 'User',
                    operation: 'findUnique',
                    args: { where: { id: '1' } },
                    data: { id: '1', name: 'John' },
                    optimisticUpdate: true,
                    updateData: updateData2,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Both queries should be updated
            expect(updateData1).toHaveBeenCalled();
            expect(updateData2).toHaveBeenCalled();
        });

        it('logs when logging is enabled', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const logger = vi.fn() as Logger;
            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, logger);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Logger should be called
            expect(logger).toHaveBeenCalled();
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('Optimistically updating'));
        });

        it('logs when skipping due to opt-out', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const logger = vi.fn() as Logger;
            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [],
                    optimisticUpdate: false,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, logger);

            await updater({ where: { id: '1' }, data: {} });

            // Logger should be called with skip message
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('Skipping optimistic update'));
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('opt-out'));
        });

        it('logs when skipping due to provider', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const logger = vi.fn() as Logger;
            const optimisticDataProvider = vi.fn(() => ({
                kind: 'Skip' as const,
            }));

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                logger,
            );

            await updater({ where: { id: '1' }, data: {} });

            // Logger should be called with skip message
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('Skipping optimistic updating'));
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('provider'));
        });

        it('logs when updating due to provider', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const logger = vi.fn() as Logger;
            const optimisticDataProvider = vi.fn(() => ({
                kind: 'Update' as const,
                data: [],
            }));

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                logger,
            );

            await updater({ where: { id: '1' }, data: {} });

            // Logger should be called with update message
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('Optimistically updating'));
            expect(logger).toHaveBeenCalledWith(expect.stringContaining('provider'));
        });

        it('handles empty query list', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const queries: QueryInfo[] = [];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            // Should not throw
            await expect(updater({ where: { id: '1' }, data: {} })).resolves.toBeUndefined();
        });

        it('handles mutations on related models', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        posts: createRelationField('posts', 'Post'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                        title: createField('title', 'String'),
                        userId: createField('userId', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'Post',
                    operation: 'findMany',
                    args: {},
                    data: [
                        { id: '1', title: 'Post 1', userId: '1' },
                        { id: '2', title: 'Post 2', userId: '2' },
                    ],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('Post', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { title: 'Updated Post 1' } });

            // Should update the cache
            expect(updateDataMock).toHaveBeenCalled();
        });

        it('extracts mutation args from first argument', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedMutationArgs: any;
            const optimisticDataProvider = vi.fn((args) => {
                capturedMutationArgs = args.mutationArgs;
                return { kind: 'Skip' as const };
            });

            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [],
                    optimisticUpdate: true,
                    updateData: vi.fn(),
                },
            ];

            const updater = createOptimisticUpdater(
                'User',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            const mutationArgs = { where: { id: '1' }, data: { name: 'Test' } };
            await updater(mutationArgs);

            // Should extract mutation args from first argument
            expect(capturedMutationArgs).toEqual(mutationArgs);
        });
    });

    describe('real-world scenarios', () => {
        it('handles user list update optimistically', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                        email: createField('email', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [
                        { id: '1', name: 'John', email: 'john@example.com' },
                        { id: '2', name: 'Jane', email: 'jane@example.com' },
                    ],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            expect(updateDataMock).toHaveBeenCalled();
            const updatedData = updateDataMock.mock.calls[0]?.[0];
            expect(Array.isArray(updatedData)).toBe(true);
        });

        it('handles custom provider for complex business logic', async () => {
            const schema = createSchema({
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                        title: createField('title', 'String'),
                        published: createField('published', 'Boolean'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            // Custom provider that only updates published posts
            const optimisticDataProvider = vi.fn(({ currentData, mutationArgs }) => {
                const posts = currentData as any[];
                const updatedPosts = posts.map((post: any) => {
                    if (post.id === mutationArgs.where.id && post.published) {
                        return { ...post, ...mutationArgs.data, $optimistic: true };
                    }
                    return post;
                });
                return { kind: 'Update' as const, data: updatedPosts };
            });

            const updateDataMock = vi.fn();
            const queries: QueryInfo[] = [
                {
                    model: 'Post',
                    operation: 'findMany',
                    args: { where: { published: true } },
                    data: [
                        { id: '1', title: 'Post 1', published: true },
                        { id: '2', title: 'Post 2', published: true },
                    ],
                    optimisticUpdate: true,
                    updateData: updateDataMock,
                },
            ];

            const updater = createOptimisticUpdater(
                'Post',
                'update',
                schema,
                { optimisticDataProvider },
                () => queries,
                undefined,
            );

            await updater({ where: { id: '1' }, data: { title: 'Updated Post 1' } });

            expect(optimisticDataProvider).toHaveBeenCalled();
            expect(updateDataMock).toHaveBeenCalled();
            const updatedData = updateDataMock.mock.calls[0]?.[0];
            expect(updatedData[0]).toHaveProperty('$optimistic', true);
        });

        it('handles mixed queries with different opt-in settings', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const updateData1 = vi.fn();
            const updateData2 = vi.fn();
            const updateData3 = vi.fn();

            const queries: QueryInfo[] = [
                {
                    model: 'User',
                    operation: 'findMany',
                    args: {},
                    data: [{ id: '1', name: 'John' }],
                    optimisticUpdate: true, // opted in
                    updateData: updateData1,
                },
                {
                    model: 'User',
                    operation: 'findUnique',
                    args: { where: { id: '1' } },
                    data: { id: '1', name: 'John' },
                    optimisticUpdate: false, // opted out
                    updateData: updateData2,
                },
                {
                    model: 'User',
                    operation: 'findUnique',
                    args: { where: { id: '2' } },
                    data: { id: '2', name: 'Jane' },
                    optimisticUpdate: true, // opted in but different ID so won't be updated
                    updateData: updateData3,
                },
            ];

            const updater = createOptimisticUpdater('User', 'update', schema, {}, () => queries, undefined);

            await updater({ where: { id: '1' }, data: { name: 'Johnny' } });

            // Only opted-in queries matching the mutation should be updated
            expect(updateData1).toHaveBeenCalled(); // opted in and matches
            expect(updateData2).not.toHaveBeenCalled(); // opted out
            expect(updateData3).not.toHaveBeenCalled(); // opted in but different ID
        });
    });
});
