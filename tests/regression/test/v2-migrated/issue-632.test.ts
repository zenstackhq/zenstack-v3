import { createTestClient } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 632', async () => {
    await createTestClient(
        `
enum InventoryUnit {
    DIGITAL
    FL_OZ
    GRAMS
    MILLILITERS
    OUNCES
    UNIT
    UNLIMITED
}
    
model TwoEnumsOneModelTest {
    id String @id @default(cuid())
    inventoryUnit   InventoryUnit @default(UNIT)
    inputUnit       InventoryUnit @default(UNIT)
}
`,
        { provider: 'postgresql', usePrismaPush: true },
    );
});
