import { describe, expect, it, vi } from 'vitest';
import { NestedReadVisitor, type NestedReadVisitorCallback } from '../src/nested-read-visitor';
import { createField, createRelationField, createSchema } from './test-helpers';

describe('NestedReadVisitor tests', () => {
    describe('basic visiting', () => {
        it('visits simple model without select or include', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', { where: { id: '1' } });

            // Should be called once for the root with undefined field
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith('User', undefined, undefined, { where: { id: '1' } });
        });

        it('handles null or undefined args', () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {},
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', null);
            expect(callback).toHaveBeenCalledWith('User', undefined, undefined, null);

            visitor.visit('User', undefined);
            expect(callback).toHaveBeenCalledWith('User', undefined, undefined, undefined);
        });
    });

    describe('include visits', () => {
        it('visits fields with include', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: true,
                },
            });

            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, {
                include: { posts: true },
            });
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'include',
                true,
            );
        });

        it('visits nested includes', () => {
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
                        comments: createRelationField('comments', 'Comment'),
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                },
            });

            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, expect.any(Object));
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'include',
                expect.any(Object),
            );
            expect(callback).toHaveBeenNthCalledWith(
                3,
                'Comment',
                expect.objectContaining({ name: 'comments' }),
                'include',
                true,
            );
        });

        it('visits multiple includes at same level', () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        posts: createRelationField('posts', 'Post'),
                        profile: createRelationField('profile', 'Profile'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Profile: {
                    name: 'Profile',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: true,
                    profile: true,
                },
            });

            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, expect.any(Object));
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'include',
                true,
            );
            expect(callback).toHaveBeenNthCalledWith(
                3,
                'Profile',
                expect.objectContaining({ name: 'profile' }),
                'include',
                true,
            );
        });
    });

    describe('select visits', () => {
        it('visits fields with select', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    posts: true,
                },
            });

            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, {
                select: { posts: true },
            });
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'select',
                true,
            );
        });

        it('visits nested selects', () => {
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
                        comments: createRelationField('comments', 'Comment'),
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    posts: {
                        select: {
                            comments: true,
                        },
                    },
                },
            });

            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenNthCalledWith(
                3,
                'Comment',
                expect.objectContaining({ name: 'comments' }),
                'select',
                true,
            );
        });

        it('visits scalar fields in select', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    id: true,
                    name: true,
                },
            });

            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'String',
                expect.objectContaining({ name: 'id' }),
                'select',
                true,
            );
            expect(callback).toHaveBeenNthCalledWith(
                3,
                'String',
                expect.objectContaining({ name: 'name' }),
                'select',
                true,
            );
        });
    });

    describe('_count handling', () => {
        it('visits _count field', () => {
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
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    _count: {
                        select: {
                            posts: true,
                        },
                    },
                },
            });

            // Should visit root, _count recursion (same model, undefined kind), and posts within _count select
            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, expect.any(Object));
            // _count causes recursion on same model with undefined kind
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'User',
                undefined,
                undefined,
                expect.objectContaining({ select: { posts: true } }),
            );
            // Then visits posts field
            expect(callback).toHaveBeenNthCalledWith(
                3,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'select',
                true,
            );
        });

        it('handles _count with nested structure', () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        posts: createRelationField('posts', 'Post'),
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    _count: {
                        select: {
                            posts: true,
                            comments: true,
                        },
                    },
                },
            });

            expect(callback).toHaveBeenCalled();
        });
    });

    describe('callback return value handling', () => {
        it('stops visiting when callback returns false', () => {
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
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn((_model, field) => {
                // Return false when visiting posts to stop recursion
                if (field?.name === 'posts') {
                    return false;
                }
                return true;
            });

            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                },
            });

            // Should visit User and posts, but not comments (stopped by returning false)
            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenNthCalledWith(1, 'User', undefined, undefined, expect.any(Object));
            expect(callback).toHaveBeenNthCalledWith(
                2,
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'include',
                expect.any(Object),
            );
        });

        it('continues visiting when callback returns undefined or true', () => {
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
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn((_model, field) => {
                if (field?.name === 'posts') {
                    return true; // Explicitly continue
                }
                return undefined;
            });

            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                },
            });

            // Should visit all three levels
            expect(callback).toHaveBeenCalledTimes(3);
        });
    });

    describe('mixed include and select', () => {
        it('handles select inside include', () => {
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
                        content: createField('content', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: {
                        select: {
                            title: true,
                        },
                    },
                },
            });

            expect(callback).toHaveBeenCalledWith('User', undefined, undefined, expect.any(Object));
            expect(callback).toHaveBeenCalledWith(
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'include',
                expect.any(Object),
            );
            expect(callback).toHaveBeenCalledWith('String', expect.objectContaining({ name: 'title' }), 'select', true);
        });

        it('handles include inside select', () => {
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
                        comments: createRelationField('comments', 'Comment'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                },
            });

            expect(callback).toHaveBeenCalledWith('User', undefined, undefined, expect.any(Object));
            expect(callback).toHaveBeenCalledWith(
                'Post',
                expect.objectContaining({ name: 'posts' }),
                'select',
                expect.any(Object),
            );
            expect(callback).toHaveBeenCalledWith(
                'Comment',
                expect.objectContaining({ name: 'comments' }),
                'include',
                true,
            );
        });
    });

    describe('edge cases', () => {
        it('handles fields not in schema gracefully', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            // Try to include a field that doesn't exist
            visitor.visit('User', {
                include: {
                    nonExistentField: true,
                },
            });

            // Should only visit the root, not the non-existent field
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('handles empty include object', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {},
            });

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('handles empty select object', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {},
            });

            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('handles visitor with no callback', () => {
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
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const visitor = new NestedReadVisitor(schema, {});

            // Should not throw
            expect(() => {
                visitor.visit('User', {
                    include: {
                        posts: true,
                    },
                });
            }).not.toThrow();
        });

        it('handles non-object select/include values', () => {
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

            const callback = vi.fn();
            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: 'not an object',
            });

            visitor.visit('User', {
                select: null,
            });

            // Should handle gracefully
            expect(callback).toHaveBeenCalledTimes(2);
        });
    });

    describe('complex real-world scenarios', () => {
        it('handles deeply nested blog post structure', () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        name: createField('name', 'String'),
                        posts: createRelationField('posts', 'Post'),
                        profile: createRelationField('profile', 'Profile'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Post: {
                    name: 'Post',
                    fields: {
                        id: createField('id', 'String'),
                        title: createField('title', 'String'),
                        comments: createRelationField('comments', 'Comment'),
                        author: createRelationField('author', 'User'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
                Comment: {
                    name: 'Comment',
                    fields: {
                        id: createField('id', 'String'),
                        text: createField('text', 'String'),
                        author: createRelationField('author', 'User'),
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

            const visitedModels: string[] = [];
            const callback: NestedReadVisitorCallback['field'] = (model) => {
                visitedModels.push(model);
            };

            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                include: {
                    posts: {
                        include: {
                            comments: {
                                include: {
                                    author: {
                                        select: {
                                            name: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    profile: true,
                },
            });

            expect(visitedModels).toContain('User');
            expect(visitedModels).toContain('Post');
            expect(visitedModels).toContain('Comment');
            expect(visitedModels).toContain('Profile');
            expect(visitedModels.filter((m) => m === 'User').length).toBeGreaterThan(1); // User visited multiple times
        });

        it('collects all visited field names', () => {
            const schema = createSchema({
                User: {
                    name: 'User',
                    fields: {
                        id: createField('id', 'String'),
                        email: createField('email', 'String'),
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
                        published: createField('published', 'Boolean'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const fieldNames: string[] = [];
            const callback: NestedReadVisitorCallback['field'] = (_model, field) => {
                if (field) {
                    fieldNames.push(field.name);
                }
            };

            const visitor = new NestedReadVisitor(schema, { field: callback });

            visitor.visit('User', {
                select: {
                    email: true,
                    posts: {
                        select: {
                            title: true,
                            published: true,
                        },
                    },
                },
            });

            expect(fieldNames).toContain('email');
            expect(fieldNames).toContain('posts');
            expect(fieldNames).toContain('title');
            expect(fieldNames).toContain('published');
        });
    });
});
