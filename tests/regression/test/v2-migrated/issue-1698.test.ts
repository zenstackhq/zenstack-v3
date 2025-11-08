import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1698', () => {
    it('verifies issue 1698', async () => {
        const db = await createTestClient(
            `
    model House {
        id         Int    @id @default(autoincrement())
        doorTypeId Int
        door       Door   @relation(fields: [doorTypeId], references: [id])
        houseType  String
        @@delegate(houseType)
    }

    model PrivateHouse extends House {
        size Int
    }

    model Skyscraper extends House {
        height Int
    }

    model Door {
        id       Int     @id @default(autoincrement())
        color    String
        doorType String
        houses   House[]
        @@delegate(doorType)
    }

    model IronDoor extends Door {
        strength Int
    }

    model WoodenDoor extends Door {
        texture String
    }
                `,
        );

        const door1 = await db.ironDoor.create({
            data: { strength: 100, color: 'blue' },
        });

        const door2 = await db.woodenDoor.create({
            data: { texture: 'pine', color: 'red' },
        });

        await db.privateHouse.create({
            data: { size: 5000, door: { connect: { id: door1.id } } },
        });

        await db.skyscraper.create({
            data: { height: 3000, door: { connect: { id: door2.id } } },
        });

        const r1 = await db.privateHouse.findFirst({ include: { door: true } });
        expect(r1).toMatchObject({
            door: { color: 'blue', strength: 100 },
        });

        const r2 = (await db.skyscraper.findMany({ include: { door: true } }))[0];
        expect(r2).toMatchObject({
            door: { color: 'red', texture: 'pine' },
        });
    });
});
