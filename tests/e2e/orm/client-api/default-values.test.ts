import { isCuid as isCuidV2 } from '@paralleldrive/cuid2';
import { isCuid as isCuidV1 } from 'cuid';
import { createTestClient } from '@zenstackhq/testtools';
import { isValid as isValidUlid } from 'ulid';
import { validate as isValidUuid, version as getUuidVersion } from 'uuid';
import { describe, expect, it } from 'vitest';

const schema = `
model Model {
    id Int @id
    uuid String @default(uuid())
    uuid4 String @default(uuid(4))
    uuid7 String @default(uuid(7))
    cuid String @default(cuid())
    cuid1 String @default(cuid(1))
    cuid2 String @default(cuid(2))
    nanoid String @default(nanoid())
    nanoid8 String @default(nanoid(8))
    ulid String @default(ulid())
    dt DateTime @default(now())
    bool Boolean @default(false)
}
`;

describe('default values tests', () => {
    it('supports defaults', async () => {
        const client = await createTestClient(schema);

        const entity = await client.model.create({ data: { id: 1 } });
        expect(entity.uuid).toSatisfy((id) => isValidUuid(id) && getUuidVersion(id) === 4);
        expect(entity.uuid4).toSatisfy((id) => isValidUuid(id) && getUuidVersion(id) === 4);
        expect(entity.uuid7).toSatisfy((id) => isValidUuid(id) && getUuidVersion(id) === 7);
        expect(entity.cuid).toSatisfy(isCuidV1);
        expect(entity.cuid1).toSatisfy(isCuidV1);
        expect(entity.cuid2).toSatisfy(isCuidV2);
        expect(entity.nanoid).toSatisfy((id) => id.length >= 21);
        expect(entity.nanoid8).toSatisfy((id) => id.length === 8);
        expect(entity.ulid).toSatisfy(isValidUlid);
        expect(entity.dt).toBeInstanceOf(Date);

        // some fields are set but some use default
        await expect(
            client.model.createMany({
                data: [{ id: 2 }, { id: 3, bool: true }],
            }),
        ).toResolveTruthy();
        await expect(client.model.findUnique({ where: { id: 2 } })).resolves.toMatchObject({
            bool: false,
        });
        await expect(client.model.findUnique({ where: { id: 3 } })).resolves.toMatchObject({
            bool: true,
        });
    });
});
