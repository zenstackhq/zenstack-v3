import { ORMError, ORMErrorReason, RejectedByPolicyReason } from '@zenstackhq/orm';
import { createPolicyTestClient, createTestClient } from '@zenstackhq/testtools';
import { match } from 'ts-pattern';
import { describe, expect, it } from 'vitest';

describe('Error handling tests', () => {
    const schema = `
model User {
  id String @id @default(cuid())
  name String?
  email String @unique @email
}
`;

    it('throws invalid input errors', async () => {
        const db: any = await createTestClient(schema);
        await expect(db.user.create({ data: { name: 'user' } })).toBeRejectedByValidation();
        await expect(db.user.create({ data: { name: 'user', email: 'foo' } })).toBeRejectedByValidation([
            'Invalid email',
        ]);
    });

    it('throws not found errors', async () => {
        const db: any = await createTestClient(schema);
        await expect(db.user.findUniqueOrThrow({ where: { id: 'non-existent-id' } })).toBeRejectedNotFound();
    });

    it('throws rejected by policy errors', async () => {
        const db: any = await createPolicyTestClient(schema);
        await expect(db.user.create({ data: { name: 'user', email: 'user@example.com' } })).rejects.toSatisfy(
            (e) =>
                e instanceof ORMError &&
                e.reason === ORMErrorReason.REJECTED_BY_POLICY &&
                e.rejectedByPolicyReason === RejectedByPolicyReason.NO_ACCESS,
        );
    });

    it('throws db query errors', async () => {
        const db: any = await createTestClient(schema);
        await db.user.create({ data: { email: 'user1@example.com' } });

        const provider = db.$schema.provider.type;
        const expectedCode = match(provider)
            .with('sqlite', () => 'SQLITE_CONSTRAINT_UNIQUE')
            .with('postgresql', () => '23505')
            .with('mysql', () => 'ER_DUP_ENTRY')
            .otherwise(() => {
                throw new Error(`Unsupported provider: ${provider}`);
            });

        await expect(db.user.create({ data: { email: 'user1@example.com' } })).rejects.toSatisfy(
            (e) =>
                e instanceof ORMError &&
                e.reason === ORMErrorReason.DB_QUERY_ERROR &&
                e.dbErrorCode === expectedCode &&
                !!e.dbErrorMessage?.match(/(constraint)|(duplicate)/i),
        );
    });
});
