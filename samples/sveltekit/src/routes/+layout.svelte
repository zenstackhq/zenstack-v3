<script lang="ts">
	import { browser } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { setQuerySettingsContext } from '@zenstackhq/tanstack-query/svelte';
	import './layout.css';

	let { children } = $props();

	const queryClient = new QueryClient({
		defaultOptions: { 
			queries: { enabled: browser }
		}
	});

	setQuerySettingsContext({ endpoint: '/api/model', logging: true });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<QueryClientProvider client={queryClient}>
	{@render children()}
</QueryClientProvider>
