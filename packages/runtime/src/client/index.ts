import type { SchemaDef } from '../schema';
import type { DBClient } from './types';

export function getClient<T extends SchemaDef>(_schema: T) {
    return undefined as any as DBClient<T>;
}
