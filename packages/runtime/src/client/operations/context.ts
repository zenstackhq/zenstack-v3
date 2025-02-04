import type { Kysely } from 'kysely';
import type { SchemaDef } from '../../schema/schema';
import type { toKysely } from '../query-builder';

export type Operations = 'findMany' | 'findUnique' | 'findFirst' | 'create';

export type OperationContext = {
    db: Kysely<toKysely<any>>;
    schema: SchemaDef;
    model: string;
    operation: Operations;
};
