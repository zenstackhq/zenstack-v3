import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #1870', () => {
    it('verifies issue 1870', async () => {
        await loadSchema(
            `
model Polygon {
    id      Int      @id @default(autoincrement())
    geometry    Unsupported("geometry(MultiPolygon, 4326)")
    @@index([geometry], name: "parcel_polygon_idx", type: Gist)
}
`,
        );
    });
});
