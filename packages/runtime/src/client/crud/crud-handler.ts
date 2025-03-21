import type { GetModels, SchemaDef } from '../../schema';
import type { BatchResult } from '../client-types';
import type { ClientOptions } from '../options';
import type { ToKysely } from '../query-builder';
import { AggregateOperationHandler } from './operations/aggregate';
import type { BaseOperationHandler } from './operations/base';
import { CountOperationHandler } from './operations/count';
import { CreateOperationHandler } from './operations/create';
import { DeleteOperationHandler } from './operations/delete';
import { FindOperationHandler } from './operations/find';
import { UpdateOperationHandler } from './operations/update';

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

export class CrudHandler<Schema extends SchemaDef> {
    private readonly findOperation: BaseOperationHandler<Schema>;
    private readonly createOperation: BaseOperationHandler<Schema>;
    private readonly updateOperation: BaseOperationHandler<Schema>;
    private readonly deleteOperation: BaseOperationHandler<Schema>;
    private readonly countOperation: BaseOperationHandler<Schema>;
    private readonly aggregateOperation: BaseOperationHandler<Schema>;

    constructor(
        protected readonly schema: Schema,
        protected readonly kysely: ToKysely<Schema>,
        public readonly options: ClientOptions<Schema>,
        protected readonly model: GetModels<Schema>
    ) {
        this.findOperation = new FindOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.createOperation = new CreateOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.updateOperation = new UpdateOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.deleteOperation = new DeleteOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.countOperation = new CountOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.aggregateOperation = new AggregateOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
    }

    findUnique(args: unknown) {
        return this.findOperation.handle('findUnique', args);
    }

    findFirst(args: unknown) {
        return this.findOperation.handle('findFirst', args);
    }

    findMany(args: unknown) {
        return this.findOperation.handle('findMany', args);
    }

    create(args: unknown) {
        return this.createOperation.handle('create', args);
    }

    createMany(args: unknown) {
        return this.createOperation.handle(
            'createMany',
            args
        ) as Promise<BatchResult>;
    }

    update(args: unknown) {
        return this.updateOperation.handle('update', args);
    }

    updateMany(args: unknown) {
        return this.updateOperation.handle(
            'updateMany',
            args
        ) as Promise<BatchResult>;
    }

    delete(args: unknown) {
        return this.deleteOperation.handle('delete', args);
    }

    deleteMany(args: unknown) {
        return this.deleteOperation.handle(
            'deleteMany',
            args
        ) as Promise<BatchResult>;
    }

    count(args: unknown) {
        return this.countOperation.handle('count', args) as Promise<unknown>;
    }

    aggregate(args: unknown) {
        return this.aggregateOperation.handle('count', args) as Promise<number>;
    }
}
