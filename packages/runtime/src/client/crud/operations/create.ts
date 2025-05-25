import { match } from 'ts-pattern';
import { RejectedByPolicyError } from '../../../plugins/policy/errors';
import type { GetModels, SchemaDef } from '../../../schema';
import type {
    CreateArgs,
    CreateManyAndReturnArgs,
    CreateManyArgs,
} from '../../crud-types';
import { getIdValues } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class CreateOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    async handle(
        operation: 'create' | 'createMany' | 'createManyAndReturn',
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
            .with('createManyAndReturn', () => {
                return this.runCreateManyAndReturn(
                    this.inputValidator.validateCreateManyAndReturnArgs(
                        this.model,
                        args
                    )
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
                this.model,
                `result is not allowed to be read back`
            );
        }

        return result;
    }

    private runCreateMany(args?: CreateManyArgs<Schema, GetModels<Schema>>) {
        if (args === undefined) {
            return { count: 0 };
        }
        return this.createMany(this.kysely, this.model, args, false);
    }

    private async runCreateManyAndReturn(
        args?: CreateManyAndReturnArgs<Schema, GetModels<Schema>>
    ) {
        if (args === undefined) {
            return [];
        }

        // TODO: avoid using transaction for simple create
        return this.safeTransaction(async (tx) => {
            const createResult = await this.createMany(
                tx,
                this.model,
                args,
                true
            );
            return this.read(tx, this.model, {
                select: args.select,
                omit: args.omit,
                where: {
                    OR: createResult.map(
                        (item) =>
                            getIdValues(this.schema, this.model, item) as any
                    ),
                } as any, // TODO: fix type
            });
        });
    }
}
