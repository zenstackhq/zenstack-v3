import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type {
    CreateArgs,
    UpdateArgs,
    UpdateManyArgs,
} from '../../client-types';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { getIdValues, requireField } from '../../query-utils';
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

    async handle(operation: 'update' | 'updateMany', args: unknown) {
        return match(operation)
            .with('update', () =>
                this.runUpdate(
                    this.inputValidator.validateUpdateArgs(this.model, args)
                )
            )
            .with('updateMany', () =>
                this.runUpdateMany(
                    this.inputValidator.validateUpdateManyArgs(this.model, args)
                )
            )
            .exhaustive();
    }

    private async runUpdate(args: UpdateArgs<Schema, GetModels<Schema>>) {
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
                        const updateResult = await this.update(
                            trx,
                            this.model,
                            args.where,
                            args.data
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
            // simple update
            const updateResult = await this.update(
                this.kysely,
                this.model,
                args.where,
                args.data
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

    private async runUpdateMany(
        args: UpdateManyArgs<Schema, GetModels<Schema>>
    ) {
        return this.updateMany(
            this.kysely,
            this.model,
            args.where,
            args.data,
            args.limit
        );
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
