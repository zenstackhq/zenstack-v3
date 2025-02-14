import type { Kysely } from 'kysely';
import type { ClientOptions } from '..';
import type { SchemaDef } from '../../schema/schema';
import type { toKysely } from '../query-builder';

export type Operations = 'findMany' | 'findUnique' | 'findFirst' | 'create';

export type OperationContext = {
    kysely: Kysely<toKysely<any>>;
    clientOptions: ClientOptions<any>;
    schema: SchemaDef;
    model: string;
    operation: Operations;
};
