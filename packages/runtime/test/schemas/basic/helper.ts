import type { DataSourceProviderType } from '@zenstackhq/sdk/schema';
import { schema } from './schema';

export function getSchema<ProviderType extends DataSourceProviderType>(type: ProviderType) {
    return {
        ...schema,
        provider: {
            type,
        },
    };
}
