import { match } from 'ts-pattern';
import { RejectedByPolicyError } from '../../../plugins/policy/errors';
import type { GetModels, SchemaDef } from '../../../schema';
import type { UpdateArgs, UpdateManyArgs, UpsertArgs } from '../../crud-types';
import { getIdValues } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class UpdateOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    async handle(operation: 'update' | 'updateMany' | 'upsert', args: unknown) {
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
            .with('upsert', () =>
                this.runUpsert(
                    this.inputValidator.validateUpsertArgs(this.model, args)
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
                omit: args.omit,
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

    private async runUpsert(args: UpsertArgs<Schema, GetModels<Schema>>) {
        const result = await this.safeTransaction(async (tx) => {
            let mutationResult = await this.update(
                tx,
                this.model,
                args.where,
                args.update,
                undefined,
                true,
                false
            );

            if (!mutationResult) {
                // non-existing, create
                mutationResult = await this.create(tx, this.model, args.create);
            }

            return this.readUnique(tx, this.model, {
                select: args.select,
                include: args.include,
                omit: args.omit,
                where: getIdValues(this.schema, this.model, mutationResult),
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
}
