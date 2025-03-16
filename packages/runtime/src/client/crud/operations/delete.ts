import type { DeleteResult } from 'kysely';
import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { DeleteArgs, DeleteManyArgs } from '../../client-types';
import { NotFoundError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class DeleteOperationHandler<
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
        operation: 'delete' | 'deleteMany',
        args: unknown | undefined
    ) {
        return match(operation)
            .with('delete', () =>
                this.runDelete(
                    this.inputValidator.validateDeleteArgs(this.model, args)
                )
            )
            .with('deleteMany', () =>
                this.runDeleteMany(
                    this.inputValidator.validateDeleteManyArgs(this.model, args)
                )
            )
            .exhaustive();
    }

    async runDelete(
        args: DeleteArgs<Schema, Extract<keyof Schema['models'], string>>
    ) {
        const returnRelations = this.needReturnRelations(this.model, args);

        if (returnRelations) {
            // employ a transaction
            return this.kysely.transaction().execute(async (trx) => {
                const existing = await this.readUnique(trx, this.model, {
                    select: args.select,
                    include: args.include,
                    where: args.where,
                });
                if (!existing) {
                    throw new NotFoundError(this.model);
                }
                await this.delete(trx, this.model, args.where, false);
                return existing;
            });
        } else {
            const result = await this.delete(
                this.kysely,
                this.model,
                args.where,
                true
            );
            if (result.length < 1) {
                throw new NotFoundError(this.model);
            }
            return this.trimResult(result[0], args);
        }
    }

    async runDeleteMany(
        args:
            | DeleteManyArgs<Schema, Extract<keyof Schema['models'], string>>
            | undefined
    ) {
        const result = await this.delete(
            this.kysely,
            this.model,
            args?.where,
            false
        );
        return { count: Number((result as DeleteResult[])[0]?.numDeletedRows) };
    }
}
