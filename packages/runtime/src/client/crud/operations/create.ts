import { match } from 'ts-pattern';
import { RejectedByPolicyError } from '../../../plugins/policy/errors';
import type { GetModels, SchemaDef } from '../../../schema';
import type { CreateArgs, CreateManyArgs } from '../../crud-types';
import { getIdValues } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class CreateOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
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
                return this.runCreateMany(
                    this.inputValidator.validateCreateManyArgs(this.model, args)
                );
            })
            .exhaustive();
    }

    private async runCreate(args: CreateArgs<Schema, GetModels<Schema>>) {
        // TODO: avoid using transaction for simple create
        const result = await this.safeTransaction(async (tx) => {
            const createResult = await this.create(tx, this.model, args.data);
            return this.readUnique(tx, this.model, {
                select: args.select,
                include: args.include,
                where: getIdValues(this.schema, this.model, createResult),
            });
        });

        if (!result) {
            throw new RejectedByPolicyError(
                `result is not allowed to be read back`
            );
        }

        return result;
    }

    private runCreateMany(args?: CreateManyArgs<Schema, GetModels<Schema>>) {
        if (args === undefined) {
            return { count: 0 };
        }
        return this.createMany(this.kysely, this.model, args);
    }
}
