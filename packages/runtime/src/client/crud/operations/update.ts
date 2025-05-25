import { match } from 'ts-pattern';
import { RejectedByPolicyError } from '../../../plugins/policy/errors';
import type { GetModels, SchemaDef } from '../../../schema';
import type { UpdateArgs, UpdateManyArgs } from '../../crud-types';
import { BaseOperationHandler } from './base';
import { getIdValues } from '../../query-utils';

export class UpdateOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
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
        const result = await this.safeTransaction(async (tx) => {
            const updated = await this.update(
                tx,
                this.model,
                args.where,
                args.data
            );
            return this.readUnique(tx, this.model, {
                select: args.select,
                include: args.include,
                where: getIdValues(this.schema, this.model, updated),
            });
        });

        if (!result) {
            throw new RejectedByPolicyError(
                this.model,
                'result is not allowed to be read back'
            );
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
}
