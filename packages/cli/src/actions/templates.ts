export const STARTER_ZMODEL = `// This is a sample model to get you started.

/// A sample data source using local sqlite db.
datasource db {
    provider = 'sqlite'
    url = 'file:./dev.db'
}

/// User model
model User {
    id       String @id @default(cuid())
    email    String @unique @email @length(6, 32)
    posts    Post[]
}

/// Post model
model Post {
    id        String   @id @default(cuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    title     String   @length(1, 256)
    content   String
    published Boolean  @default(false)
    author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId  String
}
`;

export const STARTER_MAIN_TS = `import { ZenStackClient } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import SQLite from 'better-sqlite3';
import { schema } from './zenstack/schema';

async function main() {
    const db = new ZenStackClient(schema, {
        dialect: new SqliteDialect({
            database: new SQLite('./zenstack/dev.db'),
        }),
    });
    const user = await db.user.create({
        data: {
            email: 'test@zenstack.dev',
            posts: {
                create: [
                    {
                        title: 'Hello World',
                        content: 'This is a test post',
                    },
                ],
            },
        },
        include: { posts: true }
    });
    console.log('User created:', user);
}

main();
`;
