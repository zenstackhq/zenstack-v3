import type { DataSourceProviderType } from '@zenstackhq/schema';
export * from './provider';

import { postgresql } from './postgresql';
import type { IntrospectionProvider } from './provider';
import { sqlite } from './sqlite';

export const providers: Record<DataSourceProviderType, IntrospectionProvider> = {
    postgresql,
    sqlite,
};
