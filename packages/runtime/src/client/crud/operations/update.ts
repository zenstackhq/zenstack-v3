import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { UpdateArgs, UpdateManyArgs } from '../../crud-types';
import { getIdValues, requireField } from '../../query-utils';
import { BaseOperationHandler } from './base';

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
        const hasRelationUpdate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationUpdate) {
            // employ a transaction
            try {
                result = await this.safeTransaction(async (tx) => {
                    const updateResult = await this.update(
                        tx,
                        this.model,
                        args.where,
                        args.data
                    );
                    return this.readUnique(tx, this.model, {
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
}
