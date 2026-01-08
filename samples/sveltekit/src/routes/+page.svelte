<script lang="ts">
	import { useClientQueries, type FetchFn } from '@zenstackhq/tanstack-query/svelte';
	import { LoremIpsum } from 'lorem-ipsum';
	import type { Post } from '../zenstack/models';
	import { schema } from '../zenstack/schema-lite';

	const lorem = new LoremIpsum({ wordsPerSentence: { max: 6, min: 4 } });

	let showPublishedOnly = $state(false);
	let enableFetch = $state(true);
	let optimistic = $state(false);

	const customFetch: FetchFn = async (url, init) => {
		// simulate a delay for showing optimistic update effect
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return globalThis.fetch(url, init);
	};

	const clientQueries = useClientQueries(schema, () => ({ fetch: customFetch }));
	const users = clientQueries.user.useFindMany();

	const posts = clientQueries.post.useFindMany(
		() => ({
			where: showPublishedOnly ? { published: true } : undefined,
			orderBy: { createdAt: 'desc' },
			include: { author: true }
		}),
		() => ({ enabled: enableFetch })
	);

	const createPost = clientQueries.post.useCreate(() => ({ optimisticUpdate: optimistic }));
	const deletePost = clientQueries.post.useDelete(() => ({ optimisticUpdate: optimistic }));
	const updatePost = clientQueries.post.useUpdate(() => ({ optimisticUpdate: optimistic }));

	function onCreatePost() {
		if (!users.data) {
			return;
		}

		// random title
		const title = lorem.generateWords();

		// random user as author
		const forUser = users.data[Math.floor(Math.random() * users.data.length)];

		console.log('Creating post for user:', forUser.id, 'with title:', title);
		createPost.mutate({
			data: {
				title,
				authorId: forUser.id
			}
		});
	}

	function onDeletePost(postId: string) {
		deletePost.mutate({
			where: { id: postId }
		});
	}

	function onTogglePublishPost(post: Post) {
		updatePost.mutate({
			where: { id: post.id },
			data: { published: !post.published }
		});
	}
</script>

{#if users.isFetched && (!users.data || users.data.length === 0)}
	<div class="p-4">No users found. Please run "pnpm db:init" to seed the database.</div>
{:else}
	<div class="flex flex-col mt-16 items-center gap-6 text-center sm:items-start sm:text-left">
		<h1
			class="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50"
		>
			My Awesome Blog
		</h1>

		<div class="flex gap-4">
			<a
				href="/feeds"
				class="rounded-md bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 transition-colors"
			>
				View Public Feeds
			</a>
			<a
				href="/signup"
				class="rounded-md bg-purple-600 px-4 py-2 text-white font-medium hover:bg-purple-700 transition-colors"
			>
				Sign Up
			</a>
		</div>

		<button
			onclick={onCreatePost}
			class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 cursor-pointer"
		>
			New Post
		</button>

		<div>
			<div>Current users</div>
			<div class="flex flex-col gap-1 p-2">
				{#if users.isLoading}
					<div class="text-sm text-gray-500">Loading users...</div>
				{:else if users.isError}
					<div class="text-sm text-red-500">Error loading users: {users.error.message}</div>
				{:else}
					{#each users.data as user}
						<div class="text-sm text-gray-500">
							{user.email}
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-sm text-gray-700 dark:text-gray-300">
				<input type="checkbox" bind:checked={showPublishedOnly} class="mr-2" />
				Show published only
			</label>

			<label class="text-sm text-gray-700 dark:text-gray-300">
				<input type="checkbox" bind:checked={enableFetch} class="mr-2" />
				Enable fetch
			</label>

			<label class="text-sm text-gray-700 dark:text-gray-300">
				<input type="checkbox" bind:checked={optimistic} class="mr-2" />
				Optimistic update
			</label>
		</div>

		<ul class="flex flex-col gap-2 container">
			{#if posts.data}
				{#each posts.data as post}
					<li>
						<div class="flex justify-between">
							<div class="flex gap-2 items-baseline">
								<h2 class="text-xl font-semibold">{post.title}</h2>
								{#if post.$optimistic}
									<span class="text-sm">pending</span>
								{/if}
							</div>
							<div class="ml-4 flex w-32">
								<button
									class="rounded-md px-2 py-1 text-white cursor-pointer underline text-xs"
									onclick={() => onDeletePost(post.id)}
								>
									Delete
								</button>
								<button
									class="rounded-md px-2 py-1 text-white cursor-pointer underline text-xs"
									onclick={() => onTogglePublishPost(post)}
								>
									{post.published ? 'Unpublish' : 'Publish'}
								</button>
							</div>
						</div>
						{#if !post.$optimistic}
							<p class="text-sm text-gray-500">
								by {post.author.name}
								{!post.published ? '(Draft)' : ''}
							</p>
						{/if}
					</li>
				{/each}
			{/if}
		</ul>
	</div>
{/if}
