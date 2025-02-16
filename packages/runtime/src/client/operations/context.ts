import type { Kysely } from 'kysely';
import type { SchemaDef } from '../../schema/schema';
import type { ClientOptions } from '../options';
import type { toKysely } from '../query-builder';

export type Operations = 'findMany' | 'findUnique' | 'findFirst' | 'create';

export type OperationContext<Schema extends SchemaDef> = {
    kysely: Kysely<toKysely<Schema>>;
    clientOptions: ClientOptions<Schema>;
    schema: SchemaDef;
    model: string;
    operation: Operations;
};
