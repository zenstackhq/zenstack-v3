import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1745', () => {
    it('verifies issue 1745', async () => {
        await loadSchema(
            `
datasource db {
    provider = 'postgresql'
    url      = env('DATABASE_URL')
}

enum BuyerType {
    STORE
    RESTAURANT
    WHOLESALER
}

enum ChainStore {
    ALL
    CHAINSTORE_1
    CHAINSTORE_2
    CHAINSTORE_3
}

type Id {
    id String @id @default(cuid())
}

type Base with Id {
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}

model Ad with Base {
    serial       Int          @unique @default(autoincrement())
    buyerTypes   BuyerType[]
    chainStores  ChainStore[]
    listPrice    Float
    isSold       Boolean      @default(false)

    supplier     Supplier     @relation(fields: [supplierId], references: [id])
    supplierId   String       @default(auth().companyId)

    // @@allow('all', auth().company.companyType == 'Buyer' && has(buyerTypes, auth().company.buyerType))
    // @@allow('all', auth().company.companyType == 'Supplier' && auth().companyId == supplierId)
    // @@allow('all', auth().isAdmin)
}

model Company with Base {
    name               String @unique
    organizationNumber String @unique
    users              User[]
    buyerType          BuyerType

    companyType        String
    @@delegate(companyType)

    @@allow('read, update', auth().companyId == id)
    @@allow('all', auth().isAdmin)
}

model Buyer extends Company {
    storeName  String
    type       String
    chainStore ChainStore @default(ALL)

    @@allow('read, update', auth().company.companyType == 'Buyer' && auth().companyId == id)
    @@allow('all', auth().isAdmin)
}

model Supplier extends Company {
    ads Ad[]

    @@allow('all', auth().company.companyType == 'Supplier' && auth().companyId == id)
    @@allow('all', auth().isAdmin)
}

model User with Base {
    firstName String
    lastName  String
    email     String   @unique
    username  String   @unique
    isAdmin   Boolean  @default(false)

    company   Company? @relation(fields: [companyId], references: [id])
    companyId String?

    @@allow('read', auth().id == id)
    @@allow('read', auth().companyId == companyId)
    @@allow('all', auth().isAdmin)
}
        `,
        );
    });
});
