import { match } from 'ts-pattern';
import type { SchemaDef } from '../../../schema';
import type { DeleteArgs, DeleteManyArgs } from '../../crud-types';
import { NotFoundError } from '../../errors';
import { BaseOperationHandler } from './base';

export class DeleteOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
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
        const existing = await this.readUnique(this.kysely, this.model, {
            select: args.select,
            include: args.include,
            omit: args.omit,
            where: args.where,
        });
        if (!existing) {
            throw new NotFoundError(this.model);
        }
        const result = await this.delete(
            this.kysely,
            this.model,
            args.where,
            undefined,
            false
        );
        if (result.count === 0) {
            throw new NotFoundError(this.model);
        }
        return existing;
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
            args?.limit,
            false
        );
        return result;
    }
}
