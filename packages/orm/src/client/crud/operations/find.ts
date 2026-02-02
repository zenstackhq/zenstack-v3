import type { GetModels, SchemaDef } from '../../../schema';
import type { FindArgs } from '../../crud-types';
import { BaseOperationHandler, type CoreCrudOperations } from './base';

export class FindOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(operation: CoreCrudOperations, args: unknown, validateArgs = true): Promise<unknown> {
        console.time('findHandler');
        // normalize args to strip `undefined` fields
        const normalizedArgs = this.normalizeArgs(args);

        const findOne = operation === 'findFirst' || operation === 'findUnique';

        console.time('validation');
        // parse args
        let parsedArgs = validateArgs
            ? this.inputValidator.validateFindArgs(this.model, normalizedArgs, operation)
            : (normalizedArgs as FindArgs<Schema, GetModels<Schema>, true> | undefined);
        console.timeEnd('validation');

        if (findOne) {
            // ensure "limit 1"
            parsedArgs = parsedArgs ?? {};
            parsedArgs.take = 1;
        }

        // run query
        console.time('read');
        const result = await this.read(this.client.$qb, this.model, parsedArgs);
        console.timeEnd('read');

        const finalResult = findOne ? (result[0] ?? null) : result;
        console.timeEnd('findHandler');
        return finalResult;
    }
}
