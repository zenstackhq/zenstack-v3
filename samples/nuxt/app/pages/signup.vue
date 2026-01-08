<script setup lang="ts">
import { useClientQueries } from '@zenstackhq/tanstack-query/vue';
import { ref } from 'vue';
import { schema } from '../../zenstack/schema-lite';

const email = ref('');
const successMessage = ref('');
const errorMessage = ref('');

const clientQueries = useClientQueries(schema);
const { mutate: signUp, isPending } = clientQueries.$procs.signUp.useMutation();

const handleSubmit = () => {
    successMessage.value = '';
    errorMessage.value = '';

    signUp(
        { args: { email: email.value } },
        {
            onSuccess: (user: any) => {
                successMessage.value = `Successfully created user: ${user.email}`;
                email.value = '';
            },
            onError: (error: any) => {
                errorMessage.value = error instanceof Error ? error.message : 'Failed to sign up';
            },
        },
    );
};
</script>

<template>
    <div class="flex flex-col mt-16 items-center gap-6 text-center sm:items-start sm:text-left w-full max-w-md">
        <h1 class="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">Sign Up</h1>

        <NuxtLink
            to="/"
            class="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
        >
            ← Back to Home
        </NuxtLink>

        <form @submit.prevent="handleSubmit" class="w-full flex flex-col gap-4">
            <div class="flex flex-col gap-2">
                <label for="email" class="text-sm font-medium text-gray-700 dark:text-gray-300"> Email Address </label>
                <input
                    id="email"
                    v-model="email"
                    type="email"
                    required
                    :disabled="isPending"
                    placeholder="user@example.com"
                    class="rounded-md border border-gray-300 px-4 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-50 dark:placeholder-zinc-500"
                />
            </div>

            <button
                type="submit"
                :disabled="isPending || !email"
                class="rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
                {{ isPending ? 'Signing up...' : 'Sign Up' }}
            </button>
        </form>

        <div
            v-if="successMessage"
            class="w-full p-4 rounded-md bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
        >
            {{ successMessage }}
        </div>

        <div
            v-if="errorMessage"
            class="w-full p-4 rounded-md bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
        >
            {{ errorMessage }}
        </div>
    </div>
</template>
