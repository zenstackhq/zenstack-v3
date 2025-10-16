import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2247', () => {
    it('verifies issue 2247', async () => {
        const db = await createTestClient(
            `
    model User {
      id         String   @id @default(cuid())
      employerId String?
    }

    model Member {
      id      String @id @default(cuid())
      placeId String
      place   Place  @relation(fields: [placeId], references: [id])
    }

    model Place {
      id        String   @id @default(cuid())
      name      String
      placeType String   @map("owner_type")
      members   Member[]

      @@delegate(placeType)
      @@unique([name, placeType])
    }

    model Country extends Place {
      regions Region[]
      things  Thing[]
    }

    model Region extends Place {
      countryId String
      country   Country @relation(fields: [countryId], references: [id])
      cities    City[]
    }

    model City extends Place {
      regionId String
      region   Region @relation(fields: [regionId], references: [id])
    }


    model Thing {
      id        String  @id @default(cuid())
      countryId String
      country   Country @relation(fields: [countryId], references: [id])

      @@allow('read',
        country.members?[id == auth().employerId]
        || country.regions?[members?[id == auth().employerId]]
        || country.regions?[cities?[members?[id == auth().employerId]]]
      )
    }
                `,
        );

        const authDb = db.$setAuth({ id: '1', employerId: '1' });
        await expect(authDb.thing.findMany()).toResolveTruthy();
    });
});
