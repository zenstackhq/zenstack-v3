import type { GetModels, SchemaDef } from '../../../schema';
import type { FindArgs } from '../../crud-types';
import { BaseOperationHandler, type CoreCrudOperation } from './base';

export class FindOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(operation: CoreCrudOperation, args: unknown, validateArgs = true): Promise<unknown> {
        // normalize args to strip `undefined` fields
        const normalizedArgs = this.normalizeArgs(args);

        const findOne = operation === 'findFirst' || operation === 'findUnique';

        // parse args
        let parsedArgs = validateArgs
            ? this.inputValidator.validateFindArgs(this.model, normalizedArgs, {
                  unique: operation === 'findUnique',
                  findOne,
              })
            : (normalizedArgs as FindArgs<Schema, GetModels<Schema>, true> | undefined);

        if (findOne) {
            // ensure "limit 1"
            parsedArgs = parsedArgs ?? {};
            parsedArgs.take = 1;
        }

        // run query
        const result = await this.read(this.client.$qb, this.model, parsedArgs);

        const finalResult = findOne ? (result[0] ?? null) : result;
        return finalResult;
    }
}
