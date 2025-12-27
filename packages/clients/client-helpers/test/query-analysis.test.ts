import { describe, expect, it } from 'vitest';
import { getMutatedModels, getReadModels } from '../src/query-analysis';
import { createField, createRelationField, createSchema } from './test-helpers';

describe('Query Analysis tests', () => {
    describe('getReadModels', () => {
        it('returns only the root model when no includes/selects', () => {
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

            const result = getReadModels('User', schema, {});

            expect(result).toEqual(['User']);
        });

        it('returns models from include relations', () => {
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

            const result = getReadModels('User', schema, {
                include: {
                    posts: true,
                },
            });

            expect(result).toContain('User');
            expect(result).toContain('Post');
            expect(result.length).toBe(2);
        });

        it('returns models from nested includes', () => {
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
                        text: createField('text', 'String'),
                    },
                    uniqueFields: {},
                    idFields: ['id'],
                },
            });

            const result = getReadModels('User', schema, {
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                },
            });

            expect(result).toContain('User');
            expect(result).toContain('Post');
            expect(result).toContain('Comment');
            expect(result.length).toBe(3);
        });

        it('returns models from select with relations', () => {
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

            const result = getReadModels('User', schema, {
                select: {
                    id: true,
                    posts: true,
                },
            });

            // When using select with a relation field, the visitor visits:
            // 1. User (root model)
            // 2. String (for id field)
            // 3. Post (for posts field)
            expect(result).toContain('User');
            expect(result).toContain('Post');
            expect(result.length).toBe(3); // User, String, Post
        });

        it('handles select taking precedence over include', () => {
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

            // When both select and include are present, select takes precedence
            const result = getReadModels('User', schema, {
                include: {
                    posts: true,
                },
                select: {
                    profile: true,
                },
            });

            expect(result).toContain('User');
            expect(result).toContain('Profile');
            // Posts is not included because select takes precedence
            expect(result.length).toBe(2);
        });

        it('deduplicates model names', () => {
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

            const result = getReadModels('User', schema, {
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                    comments: true,
                },
            });

            expect(result).toContain('User');
            expect(result).toContain('Post');
            expect(result).toContain('Comment');
            expect(result.length).toBe(3); // Comment should not be duplicated
        });

        it('handles undefined args', () => {
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

            const result = getReadModels('User', schema, undefined);

            expect(result).toEqual(['User']);
        });

        it('handles null args', () => {
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

            const result = getReadModels('User', schema, null);

            expect(result).toEqual(['User']);
        });
    });

    describe('getMutatedModels', () => {
        describe('basic mutations', () => {
            it('returns only the root model for simple create', async () => {
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

                const result = await getMutatedModels('User', 'create', { data: { name: 'John' } }, schema);

                expect(result).toEqual(['User']);
            });

            it('returns only the root model for simple update', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    { where: { id: '1' }, data: { name: 'Jane' } },
                    schema,
                );

                expect(result).toEqual(['User']);
            });

            it('returns only the root model for delete', async () => {
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

                const result = await getMutatedModels('User', 'delete', { where: { id: '1' } }, schema);

                expect(result).toEqual(['User']);
            });
        });

        describe('nested mutations', () => {
            it('includes models from nested create', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'create',
                    {
                        data: {
                            name: 'John',
                            posts: {
                                create: { title: 'My Post' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested update', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                update: {
                                    where: { id: '1' },
                                    data: { title: 'Updated' },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested connect', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                connect: { id: '1' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested disconnect', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                disconnect: { id: '1' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested set', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                set: [{ id: '1' }],
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested upsert', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                upsert: {
                                    where: { id: '1' },
                                    create: { title: 'New' },
                                    update: { title: 'Updated' },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested createMany', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'create',
                    {
                        data: {
                            name: 'John',
                            posts: {
                                createMany: {
                                    data: [{ title: 'Post 1' }, { title: 'Post 2' }],
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested updateMany', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                updateMany: {
                                    where: { published: false },
                                    data: { published: true },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from nested connectOrCreate', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                connectOrCreate: {
                                    where: { id: '1' },
                                    create: { title: 'New Post' },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes models from deeply nested mutations', async () => {
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
                            text: createField('text', 'String'),
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                });

                const result = await getMutatedModels(
                    'User',
                    'create',
                    {
                        data: {
                            name: 'John',
                            posts: {
                                create: {
                                    title: 'My Post',
                                    comments: {
                                        create: { text: 'Great!' },
                                    },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result).toContain('Comment');
                expect(result.length).toBe(3);
            });
        });

        describe('cascade deletes', () => {
            it('includes cascaded models when deleting', async () => {
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

                const result = await getMutatedModels('User', 'delete', { where: { id: '1' } }, schema);

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes cascaded models when using deleteMany', async () => {
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

                const result = await getMutatedModels('User', 'deleteMany', { where: { active: false } }, schema);

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result.length).toBe(2);
            });

            it('includes multi-level cascade deletes', async () => {
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

                const result = await getMutatedModels('User', 'delete', { where: { id: '1' } }, schema);

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result).toContain('Comment');
                expect(result.length).toBe(3);
            });

            it('does not include models without cascade delete', async () => {
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
                                    onDelete: 'SetNull',
                                },
                            },
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                });

                const result = await getMutatedModels('User', 'delete', { where: { id: '1' } }, schema);

                expect(result).toEqual(['User']);
            });

            it('handles circular cascade relationships', async () => {
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
                            // This creates a potential circle: User -> Post -> Comment -> Post
                            relatedPost: {
                                name: 'relatedPost',
                                type: 'Post',
                                optional: true,
                                relation: {
                                    opposite: 'relatedComments',
                                    onDelete: 'Cascade',
                                },
                            },
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                });

                const result = await getMutatedModels('User', 'delete', { where: { id: '1' } }, schema);

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result).toContain('Comment');
                expect(result.length).toBe(3);
            });
        });

        describe('delegate base models', () => {
            it('includes base model when mutating child', async () => {
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

                const result = await getMutatedModels('Dog', 'create', { data: { breed: 'Labrador' } }, schema);

                expect(result).toContain('Dog');
                expect(result).toContain('Animal');
                expect(result.length).toBe(2);
            });

            it('includes multi-level base models', async () => {
                const schema = createSchema({
                    Entity: {
                        name: 'Entity',
                        fields: {
                            id: createField('id', 'String'),
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                    Animal: {
                        name: 'Animal',
                        baseModel: 'Entity',
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

                const result = await getMutatedModels('Dog', 'create', { data: { breed: 'Labrador' } }, schema);

                expect(result).toContain('Dog');
                expect(result).toContain('Animal');
                expect(result).toContain('Entity');
                expect(result.length).toBe(3);
            });

            it('includes base models for nested mutations', async () => {
                const schema = createSchema({
                    User: {
                        name: 'User',
                        fields: {
                            id: createField('id', 'String'),
                            pets: createRelationField('pets', 'Dog'),
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
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

                const result = await getMutatedModels(
                    'User',
                    'create',
                    {
                        data: {
                            name: 'John',
                            pets: {
                                create: { breed: 'Labrador' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Dog');
                expect(result).toContain('Animal');
                expect(result.length).toBe(3);
            });
        });

        describe('edge cases', () => {
            it('handles undefined args', async () => {
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

                const result = await getMutatedModels('User', 'create', undefined, schema);

                expect(result).toEqual(['User']);
            });

            it('handles null args', async () => {
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

                const result = await getMutatedModels('User', 'create', null, schema);

                expect(result).toEqual(['User']);
            });

            it('deduplicates models from multiple sources', async () => {
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

                const result = await getMutatedModels(
                    'User',
                    'create',
                    {
                        data: {
                            name: 'John',
                            posts: {
                                create: {
                                    title: 'Post',
                                    comments: {
                                        create: { text: 'Comment' },
                                    },
                                },
                            },
                            comments: {
                                create: { text: 'Comment' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Post');
                expect(result).toContain('Comment');
                expect(result.length).toBe(3); // Comment should not be duplicated
            });

            it('handles model not in schema', async () => {
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

                const result = await getMutatedModels('NonExistent', 'create', { data: {} }, schema);

                expect(result).toEqual(['NonExistent']);
            });
        });

        describe('real-world scenarios', () => {
            it('handles complex nested mutation with cascades and base models', async () => {
                const schema = createSchema({
                    Entity: {
                        name: 'Entity',
                        fields: {
                            id: createField('id', 'String'),
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                    User: {
                        name: 'User',
                        baseModel: 'Entity',
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

                const result = await getMutatedModels(
                    'User',
                    'update',
                    {
                        where: { id: '1' },
                        data: {
                            posts: {
                                create: {
                                    title: 'New Post',
                                    comments: {
                                        create: { text: 'Comment' },
                                    },
                                },
                                delete: { id: '2' },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('User');
                expect(result).toContain('Entity'); // base model
                expect(result).toContain('Post');
                expect(result).toContain('Comment'); // both from create and cascade delete
                expect(result.length).toBe(4);
            });

            it('handles blog post creation with author, tags, and categories', async () => {
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
                            categories: createRelationField('categories', 'Category'),
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
                    Category: {
                        name: 'Category',
                        fields: {
                            id: createField('id', 'String'),
                            name: createField('name', 'String'),
                        },
                        uniqueFields: {},
                        idFields: ['id'],
                    },
                });

                const result = await getMutatedModels(
                    'Post',
                    'create',
                    {
                        data: {
                            title: 'My Post',
                            author: {
                                connect: { id: '1' },
                            },
                            tags: {
                                create: [{ name: 'tech' }, { name: 'tutorial' }],
                            },
                            categories: {
                                connectOrCreate: {
                                    where: { id: '1' },
                                    create: { name: 'Programming' },
                                },
                            },
                        },
                    },
                    schema,
                );

                expect(result).toContain('Post');
                expect(result).toContain('User');
                expect(result).toContain('Tag');
                expect(result).toContain('Category');
                expect(result.length).toBe(4);
            });
        });
    });
});
