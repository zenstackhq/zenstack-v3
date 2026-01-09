'use client';

import { Post } from '@/zenstack/models';
import { schema } from '@/zenstack/schema-lite';
import { FetchFn, useClientQueries } from '@zenstackhq/tanstack-query/react';
import { LoremIpsum } from 'lorem-ipsum';
import Link from 'next/link';
import { useState } from 'react';

const lorem = new LoremIpsum({ wordsPerSentence: { max: 6, min: 4 } });

export default function Home() {
    const [showPublishedOnly, setShowPublishedOnly] = useState(false);
    const [enableFetch, setEnableFetch] = useState(true);
    const [optimistic, setOptimistic] = useState(false);

    const fetch: FetchFn = async (url, init) => {
        // simulate a delay for showing optimistic update effect
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return globalThis.fetch(url, init);
    };

    const clientQueries = useClientQueries(schema, { fetch });
    const { data: users, isFetched: isUsersFetched } = clientQueries.user.useFindMany();

    const { data: posts } = clientQueries.post.useFindMany(
        {
            where: showPublishedOnly ? { published: true } : undefined,
            orderBy: { createdAt: 'desc' },
            include: { author: true },
        },
        { enabled: enableFetch },
    );

    const createPost = clientQueries.post.useCreate({ optimisticUpdate: optimistic });
    const deletePost = clientQueries.post.useDelete({ optimisticUpdate: optimistic });
    const updatePost = clientQueries.post.useUpdate({ optimisticUpdate: optimistic });

    const onCreatePost = () => {
        if (!users) {
            return;
        }

        // random title
        const title = lorem.generateWords();

        // random user as author
        const forUser = users[Math.floor(Math.random() * users.length)];

        console.log('Creating post for user:', forUser.id, 'with title:', title);
        createPost.mutate({
            data: {
                title,
                authorId: forUser.id,
            },
        });
    };

    const onDeletePost = (postId: string) => {
        deletePost.mutate({
            where: { id: postId },
        });
    };

    const onTogglePublishPost = (post: Post) => {
        updatePost.mutate({
            where: { id: post.id },
            data: { published: !post.published },
        });
    };

    if (isUsersFetched && (!users || users.length === 0)) {
        return <div className="p-4">No users found. Please run &quot;pnpm db:init&quot; to seed the database.</div>;
    }

    return (
        <div className="flex flex-col mt-16 items-center gap-6 text-center sm:items-start sm:text-left">
            <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
                My Awesome Blog
            </h1>

            <div className="flex gap-4">
                <Link
                    href="/feeds"
                    className="rounded-md bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 transition-colors"
                >
                    View Public Feeds
                </Link>
                <Link
                    href="/signup"
                    className="rounded-md bg-purple-600 px-4 py-2 text-white font-medium hover:bg-purple-700 transition-colors"
                >
                    Sign Up
                </Link>
            </div>

            <button
                onClick={onCreatePost}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 cursor-pointer"
            >
                New Post
            </button>

            <div>
                <div>Current users</div>
                <div className="flex flex-col gap-1 p-2">
                    {users?.map((user) => (
                        <div key={user.id} className="text-sm text-gray-500">
                            {user.email}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={showPublishedOnly}
                        onChange={(e) => setShowPublishedOnly(e.target.checked)}
                        className="mr-2"
                    />
                    Show published only
                </label>

                <label className="text-sm text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={enableFetch}
                        onChange={(e) => setEnableFetch(e.target.checked)}
                        className="mr-2"
                    />
                    Enable fetch
                </label>

                <label className="text-sm text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={optimistic}
                        onChange={(e) => setOptimistic(e.target.checked)}
                        className="mr-2"
                    />
                    Optimistic update
                </label>
            </div>

            <ul className="flex flex-col gap-2 container">
                {posts?.map((post) => (
                    <li key={post.id}>
                        <div className="flex justify-between">
                            <div className="flex gap-2 items-baseline">
                                <h2 className="text-xl font-semibold">{post.title}</h2>
                                {post.$optimistic ? <span className="text-sm">pending</span> : null}
                            </div>
                            <div className="ml-4 flex w-32">
                                <button
                                    className="rounded-md px-2 py-1 text-white cursor-pointer underline text-xs"
                                    onClick={() => onDeletePost(post.id)}
                                >
                                    Delete
                                </button>
                                <button
                                    className="rounded-md px-2 py-1 text-white cursor-pointer underline text-xs"
                                    onClick={() => onTogglePublishPost(post)}
                                >
                                    {post.published ? 'Unpublish' : 'Publish'}
                                </button>
                            </div>
                        </div>
                        {post.$optimistic ? null : (
                            <p className="text-sm text-gray-500">
                                by {post.author.name} {!post.published ? '(Draft)' : ''}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
