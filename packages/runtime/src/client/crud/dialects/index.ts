import { match } from 'ts-pattern';
import type { SchemaDef } from '../../../schema';
import type { ClientOptions } from '../../options';
import type { BaseOperationHandler } from '../operations/base';
import type { BaseCrudDialect } from './base';
import { PostgresCrudDialect } from './postgresql';
import { SqliteCrudDialect } from './sqlite';

export function getCrudDialect<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions<Schema>,
    handler: BaseOperationHandler<Schema>,
): BaseCrudDialect<Schema> {
    return match(schema.provider.type)
        .with('sqlite', () => new SqliteCrudDialect(schema, options, handler))
        .with('postgresql', () => new PostgresCrudDialect(schema, options, handler))
        .exhaustive();
}
