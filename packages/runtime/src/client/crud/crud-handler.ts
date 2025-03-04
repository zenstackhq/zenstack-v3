import type { GetModels, SchemaDef } from '../../schema';
import type { ClientOptions } from '../options';
import type { ToKysely } from '../query-builder';
import type { BaseOperationHandler } from './operations/base';
import { CreateOperationHandler } from './operations/create';
import { FindOperationHandler } from './operations/find';

export type CrudOperation = 'findMany' | 'findUnique' | 'findFirst' | 'create';

export class CrudHandler<Schema extends SchemaDef> {
    private readonly createOperation: BaseOperationHandler<Schema>;
    private readonly findHandler: BaseOperationHandler<Schema>;

    constructor(
        protected readonly schema: Schema,
        protected readonly kysely: ToKysely<Schema>,
        public readonly options: ClientOptions<Schema>,
        protected readonly model: GetModels<Schema>
    ) {
        this.createOperation = new CreateOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
        this.findHandler = new FindOperationHandler(
            schema,
            kysely,
            model,
            this.options
        );
    }

    create(args: unknown) {
        return this.createOperation.handle('create', args);
    }

    findUnique(args: unknown) {
        return this.findHandler.handle('findUnique', args);
    }

    findFirst(args: unknown) {
        return this.findHandler.handle('findFirst', args);
    }

    findMany(args: unknown) {
        return this.findHandler.handle('findMany', args);
    }
}
