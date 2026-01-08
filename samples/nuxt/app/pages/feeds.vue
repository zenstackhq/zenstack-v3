<script setup lang="ts">
import { useClientQueries } from '@zenstackhq/tanstack-query/vue';
import { schema } from '../../zenstack/schema-lite';

const clientQueries = useClientQueries(schema);
const { data: posts, isLoading, error } = clientQueries.$procs.listPublicPosts.useQuery();
</script>

<template>
    <div class="flex flex-col mt-16 items-center gap-6 text-center sm:items-start sm:text-left w-full">
        <h1 class="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">Public Feeds</h1>

        <NuxtLink
            to="/"
            class="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
        >
            ← Back to Home
        </NuxtLink>

        <div v-if="isLoading" class="text-gray-600 dark:text-gray-400">Loading public posts...</div>

        <div
            v-if="error"
            class="w-full p-4 rounded-md bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
        >
            Error loading posts: {{ error instanceof Error ? error.message : 'Unknown error' }}
        </div>

        <div v-if="!isLoading && !error && posts && posts.length === 0" class="text-gray-600 dark:text-gray-400">
            No public posts available yet.
        </div>

        <ul v-if="posts && posts.length > 0" class="flex flex-col gap-4 w-full">
            <li
                v-for="post in posts"
                :key="post.id"
                class="border border-gray-200 dark:border-zinc-700 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
                <h2 class="text-xl font-semibold text-black dark:text-zinc-50">
                    {{ post.title }}
                </h2>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Published on {{ new Date(post.createdAt).toLocaleDateString() }}
                </p>
            </li>
        </ul>

        <div v-if="posts && posts.length > 0" class="text-sm text-gray-600 dark:text-gray-400 mt-4">
            Showing {{ posts.length }} public {{ posts.length === 1 ? 'post' : 'posts' }}
        </div>
    </div>
</template>
