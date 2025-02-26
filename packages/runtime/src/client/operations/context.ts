import type { Kysely } from 'kysely';
import type { GetModels, SchemaDef } from '../../schema/schema';
import type { ClientOptions } from '../options';
import type { ToKysely } from '../query-builder';

export type Operations = 'findMany' | 'findUnique' | 'findFirst' | 'create';

export type OperationContext<Schema extends SchemaDef> = {
    kysely: Kysely<ToKysely<Schema>>;
    clientOptions: ClientOptions<Schema>;
    schema: Schema;
    model: GetModels<Schema>;
    operation: Operations;
};
