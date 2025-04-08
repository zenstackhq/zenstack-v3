import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../../schema';
import type { CreateArgs, CreateManyArgs } from '../../crud-types';
import { getIdValues, requireField } from '../../query-utils';
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
                    .execute(async (tx) => {
                        const createResult = await this.create(
                            tx,
                            this.model,
                            args.data
                        );
                        return this.readUnique(tx, this.model, {
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

    private runCreateMany(args?: CreateManyArgs<Schema, GetModels<Schema>>) {
        if (args === undefined) {
            return { count: 0 };
        }
        return this.createMany(this.kysely, this.model, args);
    }
}
