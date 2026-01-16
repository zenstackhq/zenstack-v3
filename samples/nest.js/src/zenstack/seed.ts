import { DbService } from '../db.service';

async function main() {
  const db = new DbService();
  await db.user.deleteMany({});
  await db.post.deleteMany({});

  await db.user.createMany({
    data: [
      { id: '1', name: 'Alice', email: 'alice@example.com', admin: true },
      { id: '2', name: 'Bob', email: 'bob@example.com', admin: false },
    ],
  });

  await db.post.createMany({
    data: [
      {
        id: '1',
        title: 'First Post',
        published: true,
        authorId: '1',
      },
      {
        id: '2',
        title: 'Second Post',
        published: false,
        authorId: '1',
      },
      {
        id: '3',
        title: 'Third Post',
        published: true,
        authorId: '2',
      },
    ],
  });
}

void main();
