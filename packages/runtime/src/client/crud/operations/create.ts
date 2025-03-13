import type { GetModels, SchemaDef } from '../../../schema';
import type { CreateArgs } from '../../client-types';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { getIdValues, requireField } from '../../query-utils';
import type { CrudOperation } from '../crud-handler';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class CreateOperationHandler<
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

    async handle(_operation: CrudOperation, args: unknown) {
        // parse args
        const parsedArgs = this.inputValidator.validateCreateArgs(
            this.model,
            args
        );

        // need to use the original args as zod may change the order
        // of fields during parse, and order is critical for query parts
        // like `orderBy`
        return this.runQuery(parsedArgs);
    }

    private async runQuery(args: CreateArgs<Schema, GetModels<Schema>>) {
        const hasRelationCreate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationCreate) {
            // employ a transaction
            try {
                result = await this.kysely
                    .transaction()
                    .setIsolationLevel('repeatable read')
                    .execute(async (trx) => {
                        const createResult = await this.create(
                            trx,
                            this.model,
                            args.data
                        );
                        return this.readUnique(trx, this.model, {
                            select: args.select,
                            include: args.include,
                            where: getIdValues(
                                this.schema,
                                this.model,
                                createResult
                            ),
                        });
                    });
            } catch (err) {
                // console.error(err);
                throw err;
            }
        } else {
            // simple create
            const createResult = await this.create(
                this.kysely,
                this.model,
                args.data
            );
            if (returnRelations) {
                result = this.readUnique(this.kysely, this.model, {
                    select: args.select,
                    include: args.include,
                    where: getIdValues(this.schema, this.model, createResult),
                });
            } else {
                result = this.trimResult(createResult, args);
            }
        }

        return result;
    }

    private needReturnRelations(
        model: string,
        args: CreateArgs<Schema, GetModels<Schema>>
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
