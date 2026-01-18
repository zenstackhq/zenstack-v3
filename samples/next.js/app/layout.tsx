import { Geist, Geist_Mono } from 'next/font/google';
import Image from 'next/image';
import './globals.css';
import Providers from './providers';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin'],
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
});

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <Providers>
                <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
                        <main className="flex min-h-screen w-full max-w-3xl flex-col items-center py-32 px-16 bg-white dark:bg-black sm:items-start">
                            <Image
                                className="dark:invert"
                                src="/next.svg"
                                alt="Next.js logo"
                                width={100}
                                height={20}
                                priority
                            />
                            {children}
                        </main>
                    </div>
                </body>
            </Providers>
        </html>
    );
}
