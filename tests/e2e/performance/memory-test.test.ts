import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe.skip('Memory usage test with repeated CRUD operations', () => {
    let client: any;

    beforeEach(async () => {
        client = await createTestClient(
            `
model User {
    id        String    @id @default(cuid())
    email     String    @unique
    name      String
    createdAt DateTime  @default(now())
    posts     Post[]
    comments  Comment[]
}

model Post {
    id        String    @id @default(cuid())
    title     String
    content   String
    published Boolean   @default(false)
    createdAt DateTime  @default(now())
    author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
    comments  Comment[]
}

model Comment {
    id        String   @id @default(cuid())
    content   String
    createdAt DateTime @default(now())
    post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
    postId    String
    author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
}
`,
        );
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('repeatedly executes CRUD operations with random data and tracks memory', async () => {
        // ============ CONFIGURATION ============
        // Adjust these values to test different workload scenarios
        const iterations = 100; // Number of complete CRUD cycles to execute
        const usersCount = 10; // Number of users to create per iteration
        const postsPerUser = 5; // Number of posts per user
        const commentsPerPost = 3; // Number of comments per post

        // Calculated totals
        const totalPosts = usersCount * postsPerUser;
        const totalComments = totalPosts * commentsPerPost;

        const memorySnapshots: Array<{
            iteration: number;
            rss: number;
            heapTotal: number;
            heapUsed: number;
            external: number;
        }> = [];

        // Helper function to generate random string
        const randomString = (length: number) => {
            return Math.random()
                .toString(36)
                .substring(2, 2 + length);
        };

        // Helper function to generate random content
        const randomContent = () => {
            const paragraphs = Math.floor(Math.random() * 5) + 1;
            return Array.from({ length: paragraphs }, () => randomString(100)).join('\n\n');
        };

        console.log(`\nStarting ${iterations} iterations of CRUD operations...\n`);

        for (let i = 0; i < iterations; i++) {
            // ============ CREATE ============

            // Create users
            const users = await Promise.all(
                Array.from({ length: usersCount }, (_, idx) =>
                    client.user.create({
                        data: {
                            email: `user${i}-${idx + 1}-${randomString(8)}@test.com`,
                            name: `User ${i}-${idx + 1} ${randomString(10)}`,
                        },
                    }),
                ),
            );

            // Create posts per user
            const posts: any[] = [];
            for (const user of users) {
                for (let j = 0; j < postsPerUser; j++) {
                    const post = await client.post.create({
                        data: {
                            title: `Post ${i}-${j} - ${randomString(20)}`,
                            content: randomContent(),
                            published: Math.random() > 0.5,
                            authorId: user.id,
                        },
                    });
                    posts.push(post);
                }
            }

            // Create comments per post
            const comments: any[] = [];
            for (const post of posts) {
                for (let k = 0; k < commentsPerPost; k++) {
                    const randomAuthor = users[Math.floor(Math.random() * users.length)]!;
                    const comment = await client.comment.create({
                        data: {
                            content: randomString(100),
                            postId: post.id,
                            authorId: randomAuthor.id,
                        },
                    });
                    comments.push(comment);
                }
            }

            // ============ READ ============

            // Read all users with posts and comments
            const allUsers = await client.user.findMany({
                include: {
                    posts: {
                        include: {
                            comments: true,
                        },
                    },
                    comments: true,
                },
            });
            expect(allUsers).toHaveLength(usersCount);

            // Read all posts with filtering
            await client.post.findMany({
                where: {
                    published: true,
                },
                include: {
                    author: true,
                    comments: true,
                },
            });

            // Read individual comments
            await client.comment.findMany({
                include: {
                    post: true,
                    author: true,
                },
            });

            // Aggregate operations
            const userCount = await client.user.count();
            const postCount = await client.post.count();
            const commentCount = await client.comment.count();

            expect(userCount).toBeGreaterThanOrEqual(usersCount);
            expect(postCount).toBeGreaterThanOrEqual(totalPosts);
            expect(commentCount).toBeGreaterThanOrEqual(totalComments);

            // ============ UPDATE ============

            // Update random posts
            const postsToUpdate = posts.slice(0, 5);
            for (const post of postsToUpdate) {
                await client.post.update({
                    where: { id: post.id },
                    data: {
                        title: `Updated - ${randomString(20)}`,
                        content: randomContent(),
                    },
                });
            }

            // Update random users
            const userToUpdate = users[0]!;
            await client.user.update({
                where: { id: userToUpdate.id },
                data: {
                    name: `Updated User - ${randomString(10)}`,
                },
            });

            // Update many comments
            await client.comment.updateMany({
                where: {
                    postId: posts[0]!.id,
                },
                data: {
                    content: `Bulk updated - ${randomString(50)}`,
                },
            });

            // ============ DELETE (Cleanup) ============

            // Delete all comments first (due to foreign key constraints)
            await client.comment.deleteMany({});

            // Delete all posts
            await client.post.deleteMany({});

            // Delete all users
            await client.user.deleteMany({});

            // Verify cleanup
            const remainingUsers = await client.user.count();
            const remainingPosts = await client.post.count();
            const remainingComments = await client.comment.count();

            expect(remainingUsers).toBe(0);
            expect(remainingPosts).toBe(0);
            expect(remainingComments).toBe(0);

            // ============ MEMORY SNAPSHOT ============

            // Force garbage collection if available (run tests with --expose-gc flag)
            if (global.gc) {
                global.gc();
            }

            const memUsage = process.memoryUsage();
            memorySnapshots.push({
                iteration: i + 1,
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external,
            });

            // Log progress every 10 iterations
            if ((i + 1) % 10 === 0) {
                console.log(`Completed ${i + 1}/${iterations} iterations`);
                console.log(
                    `  Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB heap used, ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB RSS`,
                );
            }
        }

        // ============ MEMORY ANALYSIS ============

        console.log('\n=== Memory Usage Summary ===\n');

        const firstSnapshot = memorySnapshots[0]!;
        const lastSnapshot = memorySnapshots[memorySnapshots.length - 1]!;
        const maxHeapUsed = Math.max(...memorySnapshots.map((s) => s.heapUsed));
        const minHeapUsed = Math.min(...memorySnapshots.map((s) => s.heapUsed));
        const avgHeapUsed = memorySnapshots.reduce((sum, s) => sum + s.heapUsed, 0) / memorySnapshots.length;

        const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

        console.log('Heap Used:');
        console.log(`  Initial:  ${formatMB(firstSnapshot.heapUsed)} MB`);
        console.log(`  Final:    ${formatMB(lastSnapshot.heapUsed)} MB`);
        console.log(`  Min:      ${formatMB(minHeapUsed)} MB`);
        console.log(`  Max:      ${formatMB(maxHeapUsed)} MB`);
        console.log(`  Average:  ${formatMB(avgHeapUsed)} MB`);
        console.log(
            `  Growth:   ${formatMB(lastSnapshot.heapUsed - firstSnapshot.heapUsed)} MB (${(((lastSnapshot.heapUsed - firstSnapshot.heapUsed) / firstSnapshot.heapUsed) * 100).toFixed(2)}%)`,
        );

        console.log('\nRSS (Resident Set Size):');
        console.log(`  Initial:  ${formatMB(firstSnapshot.rss)} MB`);
        console.log(`  Final:    ${formatMB(lastSnapshot.rss)} MB`);
        console.log(
            `  Growth:   ${formatMB(lastSnapshot.rss - firstSnapshot.rss)} MB (${(((lastSnapshot.rss - firstSnapshot.rss) / firstSnapshot.rss) * 100).toFixed(2)}%)`,
        );

        console.log('\nHeap Total:');
        console.log(`  Initial:  ${formatMB(firstSnapshot.heapTotal)} MB`);
        console.log(`  Final:    ${formatMB(lastSnapshot.heapTotal)} MB`);

        console.log('\n=== Test Summary ===');
        console.log(`Total iterations: ${iterations}`);
        console.log(`Operations per iteration:`);
        console.log(`  - Created: ${usersCount} users, ${totalPosts} posts, ${totalComments} comments`);
        console.log(`  - Read: Multiple queries with includes and filters`);
        console.log(`  - Updated: 5 posts, 1 user, bulk comment updates`);
        console.log(`  - Deleted: All data (cleanup)`);
        const opsPerIteration = usersCount + totalPosts + totalComments + 10; // approximate CRUD ops
        console.log(`Total operations: ~${iterations * opsPerIteration}`);

        // Check for significant memory leaks (> 50% growth is concerning)
        const heapGrowthPercent = ((lastSnapshot.heapUsed - firstSnapshot.heapUsed) / firstSnapshot.heapUsed) * 100;
        if (heapGrowthPercent > 50) {
            console.log(
                `\n⚠️  Warning: Heap usage grew by ${heapGrowthPercent.toFixed(2)}% which may indicate a memory leak`,
            );
        } else {
            console.log(`\n✓ Memory usage appears stable (${heapGrowthPercent.toFixed(2)}% growth)`);
        }

        console.log('\n');

        // Store snapshots for potential further analysis
        expect(memorySnapshots).toHaveLength(iterations);
    }, 120000); // 2 minute timeout for the test
});
