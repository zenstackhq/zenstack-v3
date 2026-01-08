'use client';

import { schema } from '@/zenstack/schema-lite';
import { useClientQueries } from '@zenstackhq/tanstack-query/react';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function SignupPage() {
    const [email, setEmail] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const clientQueries = useClientQueries(schema);
    const signUpMutation = clientQueries.$procs.signUp.useMutation();

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSuccessMessage('');
        setErrorMessage('');

        signUpMutation.mutate(
            { args: { email } },
            {
                onSuccess: (user) => {
                    setSuccessMessage(`Successfully created user: ${user.email}`);
                    setEmail('');
                },
                onError: (error) => {
                    setErrorMessage(error instanceof Error ? error.message : 'Failed to sign up');
                },
            },
        );
    };

    return (
        <div className="flex flex-col mt-16 items-center gap-6 text-center sm:items-start sm:text-left w-full max-w-md">
            <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">Sign Up</h1>

            <Link
                href="/"
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
            >
                ← Back to Home
            </Link>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Email Address
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={signUpMutation.isPending}
                        placeholder="user@example.com"
                        className="rounded-md border border-gray-300 px-4 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-50 dark:placeholder-zinc-500"
                    />
                </div>

                <button
                    type="submit"
                    disabled={signUpMutation.isPending || !email}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    {signUpMutation.isPending ? 'Signing up...' : 'Sign Up'}
                </button>
            </form>

            {successMessage && (
                <div className="w-full p-4 rounded-md bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                    {successMessage}
                </div>
            )}

            {errorMessage && (
                <div className="w-full p-4 rounded-md bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    {errorMessage}
                </div>
            )}
        </div>
    );
}
