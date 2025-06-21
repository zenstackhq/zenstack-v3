import type { GetModels, SchemaDef } from '../../../schema';
import type { FindArgs } from '../../crud-types';
import { BaseOperationHandler, type CrudOperation } from './base';

export class FindOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(operation: CrudOperation, args: unknown, validateArgs = true): Promise<unknown> {
        // parse args
        const parsedArgs = validateArgs
            ? this.inputValidator.validateFindArgs(this.model, operation === 'findUnique', args)
            : args;

        // run query
        const result = await this.read(
            this.client.$qb,
            this.model,
            parsedArgs as FindArgs<Schema, GetModels<Schema>, true>,
        );

        const finalResult = operation === 'findMany' ? result : (result[0] ?? null);
        return finalResult;
    }
}
