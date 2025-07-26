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
        const readBackResult = await this.safeTransaction(async (tx) => {
            const updateResult = await this.update(tx, this.model, args.where, args.data);
            // updated can be undefined if there's nothing to update, in that case we'll use the original
            // filter to read back the entity
            const readFilter = updateResult ?? args.where;
            let readBackResult: any = undefined;
            try {
                readBackResult = await this.readUnique(tx, this.model, {
                    select: args.select,
                    include: args.include,
                    omit: args.omit,
                    where: readFilter as WhereInput<Schema, GetModels<Schema>, false>,
                });
            } catch {
                // commit the update even if read-back failed
            }
            return readBackResult;
        });

        if (!readBackResult) {
            // update succeeded but result cannot be read back
            if (this.hasPolicyEnabled) {
                // if access policy is enabled, we assume it's due to read violation (not guaranteed though)
                throw new RejectedByPolicyError(this.model, 'result is not allowed to be read back');
            } else {
                // this can happen if the entity is cascade deleted during the update, return null to
                // be consistent with Prisma even though it doesn't comply with the method signature
                return null;
            }
        } else {
            return readBackResult;
        }
    }

    private async runUpdateMany(args: UpdateManyArgs<Schema, GetModels<Schema>>) {
        // TODO: avoid using transaction for simple update
        return this.safeTransaction(async (tx) => {
            return this.updateMany(tx, this.model, args.where, args.data, args.limit, false);
        });
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
            let mutationResult: unknown = await this.update(
                tx,
                this.model,
                args.where,
                args.update,
                undefined,
                true,
                false,
            );

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
