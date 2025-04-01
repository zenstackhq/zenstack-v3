import type { Client } from '..';
import type { GetModels, SchemaDef } from '../../schema';
import type { BatchResult } from '../client-types';
import type { QueryContext } from '../query-executor';
import { AggregateOperationHandler } from './operations/aggregate';
import { CountOperationHandler } from './operations/count';
import { CreateOperationHandler } from './operations/create';
import { DeleteOperationHandler } from './operations/delete';
import { FindOperationHandler } from './operations/find';
import { UpdateOperationHandler } from './operations/update';
import type { InputValidator } from './operations/validator';

export type CrudOperation =
    | 'findMany'
    | 'findUnique'
    | 'findFirst'
    | 'create'
    | 'createMany'
    | 'update'
    | 'updateMany'
    | 'delete'
    | 'deleteMany'
    | 'count'
    | 'aggregate'
    | 'groupBy';

// TODO: remove this class
export class CrudHandler<Schema extends SchemaDef> {
    protected readonly queryContext: QueryContext<Schema>;

    constructor(
        protected readonly client: Client<Schema>,
        protected readonly inputValidator: InputValidator<Schema>,
        protected readonly model: GetModels<Schema>,
        operation: CrudOperation,
        args: unknown
    ) {
        this.queryContext = {
            client: this.client,
            model: this.model,
            operation,
            args,
        };
    }

    findUnique(args: unknown) {
        return new FindOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('findUnique', args);
    }

    findFirst(args: unknown) {
        return new FindOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('findFirst', args);
    }

    findMany(args: unknown) {
        return new FindOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('findMany', args);
    }

    create(args: unknown) {
        return new CreateOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('create', args);
    }

    createMany(args: unknown) {
        return new CreateOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('createMany', args) as Promise<BatchResult>;
    }

    update(args: unknown) {
        return new UpdateOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('update', args);
    }

    updateMany(args: unknown) {
        return new UpdateOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('updateMany', args) as Promise<BatchResult>;
    }

    delete(args: unknown) {
        return new DeleteOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('delete', args);
    }

    deleteMany(args: unknown) {
        return new DeleteOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('deleteMany', args) as Promise<BatchResult>;
    }

    count(args: unknown) {
        return new CountOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('count', args) as Promise<unknown>;
    }

    aggregate(args: unknown) {
        return new AggregateOperationHandler(
            this.client,
            this.model,
            this.inputValidator,
            this.queryContext
        ).handle('aggregate', args) as Promise<number>;
    }
}
