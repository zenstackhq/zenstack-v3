import { describe, expect, it, vi } from 'vitest';
import { createInvalidator } from '../src/invalidation';
import type { Logger } from '../src/logging';
import { createField, createRelationField, createSchema } from './test-helpers';

describe('Invalidation tests', () => {
    describe('createInvalidator', () => {
        it('creates an invalidator function that invalidates the mutated model', async () => {
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

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            // Call the invalidator with mutation result and variables
            const result = { id: '1', name: 'John' };
            const variables = { data: { name: 'John' } };
            await invalidator(result, variables);

            // Invalidator should have been called
            expect(invalidatorMock).toHaveBeenCalledTimes(1);
            expect(invalidatorMock).toHaveBeenCalledWith(expect.any(Function));

            // Test the predicate
            expect(capturedPredicate({ model: 'User', args: {} })).toBe(true);
        });

        it('invalidates nested models from mutation', async () => {
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
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            // Create user with nested post
            await invalidator(
                {},
                {
                    data: {
                        name: 'John',
                        posts: {
                            create: { title: 'My Post' },
                        },
                    },
                },
            );

            // Should invalidate both User and Post
            expect(capturedPredicate({ model: 'User', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Post', args: {} })).toBe(true);
        });

        it('works with undefined logging', async () => {
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

            const invalidatorMock = vi.fn();
            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            await invalidator({}, { data: {} });

            expect(invalidatorMock).toHaveBeenCalled();
        });

        it('logs when logger is provided', async () => {
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

            const loggerMock = vi.fn() as Logger;
            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, loggerMock);

            await invalidator({}, { data: { name: 'John' } });

            // Execute the predicate to trigger logging
            capturedPredicate({ model: 'User', args: {} });

            // Logger should have been called
            expect(loggerMock).toHaveBeenCalledWith(expect.stringContaining('Marking "User" query for invalidation'));
        });

        it('handles multiple mutations with different operations', async () => {
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

            const capturedPredicates: any[] = [];
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicates.push(predicate);
            });

            // Create invalidators for different operations
            const createInvalidatorFn = createInvalidator('User', 'create', schema, invalidatorMock, undefined);
            const updateInvalidatorFn = createInvalidator('User', 'update', schema, invalidatorMock, undefined);
            const deleteInvalidatorFn = createInvalidator('User', 'delete', schema, invalidatorMock, undefined);

            // Execute each invalidator
            await createInvalidatorFn({}, { data: { name: 'John' } });
            await updateInvalidatorFn({}, { where: { id: '1' }, data: { name: 'Jane' } });
            await deleteInvalidatorFn({}, { where: { id: '1' } });

            // All should invalidate User queries
            expect(capturedPredicates).toHaveLength(3);
            capturedPredicates.forEach((predicate) => {
                expect(predicate({ model: 'User', args: {} })).toBe(true);
            });
        });

        it('handles cascade deletes correctly', async () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                        user: {
                            name: 'user',
                            type: 'User',
                            optional: false,
                            relation: {
                                opposite: 'posts',
                                onDelete: 'Cascade',
                            },
                        },
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'delete', schema, invalidatorMock, undefined);

            await invalidator({}, { where: { id: '1' } });

            // Should invalidate both User and Post (cascade)
            expect(capturedPredicate({ model: 'User', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Post', args: {} })).toBe(true);
        });

        it('handles base model inheritance', async () => {
            const schema = createSchema({
                Animal: {
                    name: 'Animal',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Dog: {
                    name: 'Dog',
                    baseModel: 'Animal',
                    fields: {
                        id: createField('id', 'String'),
                        breed: createField('breed', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('Dog', 'create', schema, invalidatorMock, undefined);

            await invalidator({}, { data: { breed: 'Labrador' } });

            // Should invalidate both Dog and Animal (base)
            expect(capturedPredicate({ model: 'Dog', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Animal', args: {} })).toBe(true);
        });

        it('handles async invalidator function', async () => {
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

            const invalidatorMock = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            await invalidator({}, { data: {} });

            expect(invalidatorMock).toHaveBeenCalled();
        });

        it('passes correct predicate for nested reads', async () => {
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
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Profile: {
                    name: 'Profile',
                    fields: {
                        id: createField('id', 'String'),
                        bio: createField('bio', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('Post', 'create', schema, invalidatorMock, undefined);

            await invalidator({}, { data: { title: 'New Post' } });

            // Should invalidate User queries that include posts
            expect(
                capturedPredicate({
                    model: 'User',
                    args: {
                        include: { posts: true },
                    },
                }),
            ).toBe(true);

            // Should not invalidate User queries without posts
            expect(
                capturedPredicate({
                    model: 'User',
                    args: {
                        select: { id: true },
                    },
                }),
            ).toBe(false);

            // Should not invalidate unrelated Profile queries
            expect(capturedPredicate({ model: 'Profile', args: {} })).toBe(false);
        });

        it('handles undefined mutation variables', async () => {
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

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            await invalidator({}, undefined);

            // Should still invalidate User queries
            expect(capturedPredicate({ model: 'User', args: {} })).toBe(true);
        });

        it('uses the second argument as variables', async () => {
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
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'create', schema, invalidatorMock, undefined);

            // First argument is typically the mutation result, second is variables
            const result = { id: '1', name: 'John' };
            const variables = {
                data: {
                    name: 'John',
                    posts: {
                        create: { title: 'Post' },
                    },
                },
            };

            await invalidator(result, variables);

            // Should pick up the nested Post from variables
            expect(capturedPredicate({ model: 'Post', args: {} })).toBe(true);
        });
    });

    describe('real-world scenarios', () => {
        it('handles blog post creation with multiple relations', async () => {
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
                        author: createRelationField('author', 'User'),
                        tags: createRelationField('tags', 'Tag'),
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Tag: {
                    name: 'Tag',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                        text: createField('text', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('Post', 'create', schema, invalidatorMock, undefined);

            await invalidator(
                {},
                {
                    data: {
                        title: 'My Post',
                        author: { connect: { id: '1' } },
                        tags: {
                            create: [{ name: 'tech' }],
                        },
                        comments: {
                            create: { text: 'First!' },
                        },
                    },
                },
            );

            // Should invalidate all involved models
            expect(capturedPredicate({ model: 'Post', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'User', args: { include: { posts: true } } })).toBe(true);
            expect(capturedPredicate({ model: 'Tag', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Comment', args: {} })).toBe(true);
        });

        it('handles complex update with disconnect and delete', async () => {
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
                        user: {
                            name: 'user',
                            type: 'User',
                            optional: false,
                            relation: {
                                opposite: 'posts',
                                onDelete: 'Cascade',
                            },
                        },
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                        post: {
                            name: 'post',
                            type: 'Post',
                            optional: false,
                            relation: {
                                opposite: 'comments',
                                onDelete: 'Cascade',
                            },
                        },
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            let capturedPredicate: any;
            const invalidatorMock = vi.fn((predicate) => {
                capturedPredicate = predicate;
            });

            const invalidator = createInvalidator('User', 'update', schema, invalidatorMock, undefined);

            await invalidator(
                {},
                {
                    where: { id: '1' },
                    data: {
                        posts: {
                            disconnect: { id: '1' },
                            delete: { id: '2' }, // Will cascade to comments
                        },
                    },
                },
            );

            // Should invalidate all three models
            expect(capturedPredicate({ model: 'User', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Post', args: {} })).toBe(true);
            expect(capturedPredicate({ model: 'Comment', args: {} })).toBe(true); // cascade delete
        });

        it('integrates with query library invalidation flow', async () => {
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

            // Simulate a query library's invalidation mechanism
            const queries = [
                { queryKey: ['User', 'findMany', {}], model: 'User', args: {} },
                {
                    queryKey: ['User', 'findUnique', { where: { id: '1' } }],
                    model: 'User',
                    args: { where: { id: '1' } },
                },
                { queryKey: ['Post', 'findMany', {}], model: 'Post', args: {} },
            ];

            const invalidatedQueries: any[] = [];
            const queryLibraryInvalidate = vi.fn((predicate) => {
                queries.forEach((query) => {
                    if (predicate({ model: query.model, args: query.args })) {
                        invalidatedQueries.push(query.queryKey);
                    }
                });
            });

            const invalidator = createInvalidator('User', 'create', schema, queryLibraryInvalidate, undefined);

            await invalidator({}, { data: { name: 'John' } });

            // Should only invalidate User queries
            expect(invalidatedQueries).toHaveLength(2);
            expect(invalidatedQueries).toContainEqual(['User', 'findMany', {}]);
            expect(invalidatedQueries).toContainEqual(['User', 'findUnique', { where: { id: '1' } }]);
            expect(invalidatedQueries).not.toContainEqual(['Post', 'findMany', {}]);
        });
    });
});
