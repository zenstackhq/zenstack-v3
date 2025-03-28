import type { GetModels, SchemaDef } from '../../../schema';
import type { FindArgs } from '../../client-types';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import type { CrudOperation } from '../crud-handler';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class FindOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    private readonly inputValidator: InputValidator<Schema>;

    constructor(
        schema: Schema,
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        options: ClientOptions<Schema>
    ) {
        super(schema, kysely, model, options);
        this.inputValidator = new InputValidator(this.schema);
    }

    async handle(
        operation: CrudOperation,
        args: unknown,
        validateArgs = true
    ): Promise<unknown> {
        // parse args
        const parsedArgs = validateArgs
            ? this.inputValidator.validateFindArgs(
                  this.model,
                  operation === 'findUnique',
                  args
              )
            : args;

        // run query
        const result = await this.runQuery(
            this.model,
            parsedArgs as FindArgs<Schema, GetModels<Schema>, true>
        );

        const finalResult =
            operation === 'findMany' ? result : result[0] ?? null;
        return finalResult;
    }

    async runQuery(
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true> | undefined
    ) {
        return this.read(this.kysely, model, args);
    }
}
