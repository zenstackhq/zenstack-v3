import { match } from 'ts-pattern';
import { RejectedByPolicyError } from '../../../plugins/policy/errors';
import type { GetModels, SchemaDef } from '../../../schema';
import type { UpdateArgs, UpdateManyAndReturnArgs, UpdateManyArgs, UpsertArgs, WhereInput } from '../../crud-types';
import { getIdValues } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class UpdateOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(operation: 'update' | 'updateMany' | 'updateManyAndReturn' | 'upsert', args: unknown) {
        // normalize args to strip `undefined` fields
        const normalizedArgs = this.normalizeArgs(args);

        return match(operation)
            .with('update', () => this.runUpdate(this.inputValidator.validateUpdateArgs(this.model, normalizedArgs)))
            .with('updateMany', () =>
                this.runUpdateMany(this.inputValidator.validateUpdateManyArgs(this.model, normalizedArgs)),
            )
            .with('updateManyAndReturn', () =>
                this.runUpdateManyAndReturn(
                    this.inputValidator.validateUpdateManyAndReturnArgs(this.model, normalizedArgs),
                ),
            )
            .with('upsert', () => this.runUpsert(this.inputValidator.validateUpsertArgs(this.model, normalizedArgs)))
            .exhaustive();
    }

    private async runUpdate(args: UpdateArgs<Schema, GetModels<Schema>>) {
        const result = await this.safeTransaction(async (tx) => {
            const updated = await this.update(tx, this.model, args.where, args.data);
            return this.readUnique(tx, this.model, {
                select: args.select,
                include: args.include,
                omit: args.omit,
                where: getIdValues(this.schema, this.model, updated) as WhereInput<Schema, GetModels<Schema>, false>,
            });
        });

        if (!result && this.hasPolicyEnabled) {
            throw new RejectedByPolicyError(this.model, 'result is not allowed to be read back');
        }

        // NOTE: update can actually return null if the entity being updated is deleted
        // due to cascade when a relation is deleted during update. This doesn't comply
        // with `update`'s method signature, but we'll allow it to be consistent with Prisma.
        return result;
    }

    private async runUpdateMany(args: UpdateManyArgs<Schema, GetModels<Schema>>) {
        return this.updateMany(this.kysely, this.model, args.where, args.data, args.limit, false);
    }

    private async runUpdateManyAndReturn(args: UpdateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined) {
        if (!args) {
            return [];
        }

        return this.safeTransaction(async (tx) => {
            const updateResult = await this.updateMany(tx, this.model, args.where, args.data, args.limit, true);
            return this.read(tx, this.model, {
                select: args.select,
                omit: args.omit,
                where: {
                    OR: updateResult.map((item) => getIdValues(this.schema, this.model, item) as any),
                } as any, // TODO: fix type
            });
        });
    }

    private async runUpsert(args: UpsertArgs<Schema, GetModels<Schema>>) {
        const result = await this.safeTransaction(async (tx) => {
            let mutationResult = await this.update(tx, this.model, args.where, args.update, undefined, true, false);

            if (!mutationResult) {
                // non-existing, create
                mutationResult = await this.create(tx, this.model, args.create);
            }

            return this.readUnique(tx, this.model, {
                select: args.select,
                include: args.include,
                omit: args.omit,
                where: getIdValues(this.schema, this.model, mutationResult) as WhereInput<
                    Schema,
                    GetModels<Schema>,
                    false
                >,
            });
        });

        if (!result && this.hasPolicyEnabled) {
            throw new RejectedByPolicyError(this.model, 'result is not allowed to be read back');
        }

        return result;
    }
}
