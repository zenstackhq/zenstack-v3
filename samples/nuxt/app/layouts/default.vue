<template>
    <div class="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <main
            class="flex min-h-screen w-full max-w-3xl flex-col items-center py-32 px-16 bg-white dark:bg-black sm:items-start"
        >
            <img src="/nuxt.svg" alt="Nuxt logo" width="100" height="20" />
            <slot />
        </main>
    </div>
</template>
