import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1467', () => {
    it('verifies issue 1467', async () => {
        const db = await createTestClient(
            `
    model User {
        id   Int    @id @default(autoincrement())
        type String
    }

    model Container {
        id    Int    @id @default(autoincrement())
        drink Drink @relation(fields: [drinkId], references: [id])
        drinkId Int
    }

    model Drink {
        id                Int   @id @default(autoincrement())
        name              String @unique
        containers        Container[]
        type              String

        @@delegate(type)
    }

    model Beer extends Drink {
    }
            `,
        );

        await db.beer.create({
            data: { id: 1, name: 'Beer1' },
        });

        await db.container.create({ data: { drink: { connect: { id: 1 } } } });
        await db.container.create({ data: { drink: { connect: { id: 1 } } } });

        const beers = await db.beer.findFirst({
            select: { id: true, name: true, _count: { select: { containers: true } } },
            orderBy: { name: 'asc' },
        });
        expect(beers).toMatchObject({ _count: { containers: 2 } });
    });
});
