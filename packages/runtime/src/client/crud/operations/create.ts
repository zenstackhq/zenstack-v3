import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { CreateArgs, CreateManyArgs } from '../../client-types';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { getIdValues, requireField } from '../../query-utils';
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

    async handle(
        operation: 'create' | 'createMany',
        args: unknown | undefined
    ) {
        return match(operation)
            .with('create', () =>
                this.runCreate(
                    this.inputValidator.validateCreateArgs(this.model, args)
                )
            )
            .with('createMany', () => {
                if (args === undefined) {
                    return { count: 0 };
                }
                return this.runCreateMany(
                    this.inputValidator.validateCreateManyArgs(this.model, args)
                );
            })
            .exhaustive();
    }

    private async runCreate(args: CreateArgs<Schema, GetModels<Schema>>) {
        const hasRelationCreate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationCreate || returnRelations) {
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
            result = this.trimResult(createResult, args);
        }

        return result;
    }

    private runCreateMany(
        parsedArgs: CreateManyArgs<Schema, GetModels<Schema>>
    ) {
        return this.createMany(this.kysely, this.model, parsedArgs);
    }
}
