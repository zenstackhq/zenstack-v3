import { createTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1518', () => {
    it('verifies issue 1518', async () => {
        const db = await createTestClient(
            `
model Activity {
    id        String       @id @default(uuid())
    title     String
    type      String
    @@delegate(type)
    @@allow('all', true)
}

model TaskActivity extends Activity {
    description String
    @@map("task_activity")
    @@allow('all', true)
}
            `,
        );

        await db.taskActivity.create({
            data: {
                id: '00000000-0000-0000-0000-111111111111',
                title: 'Test Activity',
                description: 'Description of task',
            },
        });
    });
});
