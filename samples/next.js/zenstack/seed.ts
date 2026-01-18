import { db } from '@/lib/db';

async function main() {
    await db.user.deleteMany();
    await db.user.createMany({
        data: [
            { id: '1', name: 'Alice', email: 'alice@example.com' },
            { id: '2', name: 'Bob', email: 'bob@example.com' },
        ],
    });
}

main();
