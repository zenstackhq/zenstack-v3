import type { GetModels, SchemaDef } from '../../../schema';
import type { CreateArgs, UpdateArgs } from '../../client-types';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { getIdValues, requireField } from '../../query-utils';
import type { CrudOperation } from '../crud-handler';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class UpdateOperationHandler<
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

    async handle(operation: CrudOperation, args: unknown) {
        // parse args
        const parsedArgs = this.inputValidator.validateUpdateArgs(
            this.model,
            args
        );

        // need to use the original args as zod may change the order
        // of fields during parse, and order is critical for query parts
        // like `orderBy`
        return this.runQuery(parsedArgs, operation);
    }

    private async runQuery(
        args: UpdateArgs<Schema, GetModels<Schema>>,
        _operation: CrudOperation
    ) {
        const hasRelationUpdate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationUpdate) {
            // employ a transaction
            try {
                result = await this.kysely
                    .transaction()
                    .setIsolationLevel('repeatable read')
                    .execute(async (trx) => {
                        const updateResult = await this.doUpdate(
                            trx,
                            this.model,
                            args
                        );
                        return this.readUnique(trx, this.model, {
                            select: args.select,
                            include: args.include,
                            where: getIdValues(
                                this.schema,
                                this.model,
                                updateResult
                            ),
                        });
                    });
            } catch (err) {
                // console.error(err);
                throw err;
            }
        } else {
            // simple create
            const updateResult = await this.doUpdate(
                this.kysely,
                this.model,
                args
            );
            if (returnRelations) {
                result = await this.readUnique(this.kysely, this.model, {
                    select: args.select,
                    include: args.include,
                    where: getIdValues(this.schema, this.model, updateResult),
                });
            } else {
                result = this.trimResult(updateResult, args);
            }
        }

        return result;
    }

    private doUpdate(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: UpdateArgs<Schema, GetModels<Schema>>
    ) {
        return this.update(kysely, model, args.where, args.data);
    }

    private needReturnRelations(
        model: string,
        args:
            | CreateArgs<Schema, GetModels<Schema>>
            | UpdateArgs<Schema, GetModels<Schema>>
    ) {
        let returnRelation = false;

        if (args.include) {
            returnRelation = Object.keys(args.include).length > 0;
        } else if (args.select) {
            returnRelation = Object.entries(args.select).some(([K, v]) => {
                const fieldDef = this.requireField(model, K);
                return fieldDef.relation && v;
            });
        }
        return returnRelation;
    }
}
