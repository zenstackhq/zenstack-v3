<script lang="ts">
  import { browser } from "$app/environment";
  import favicon from "$lib/assets/favicon.svg";
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import { setQuerySettingsContext } from "@zenstackhq/tanstack-query/svelte";
  import "./layout.css";

  let { children } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { enabled: browser },
    },
  });

  setQuerySettingsContext({ endpoint: "/api/model", logging: true });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<QueryClientProvider client={queryClient}>
  <div
    class="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black"
  >
    <main
      class="flex min-h-screen w-full max-w-3xl flex-col items-center bg-white px-16 py-32 sm:items-start dark:bg-black"
    >
      <img src="/svelte.png" alt="SvelteKit logo" width="100" height="20" />
      {@render children()}
    </main>
  </div>
</QueryClientProvider>
