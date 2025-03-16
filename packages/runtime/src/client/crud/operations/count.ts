import { sql } from 'kysely';
import type { GetModels, SchemaDef } from '../../../schema';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class CountOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    private readonly inputValidator: InputValidator<Schema>;

    constructor(
        schema: Schema,
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        options: ClientOptions<Schema>
    ) {
        super(schema, kysely, model, options);
        this.inputValidator = new InputValidator(this.schema);
    }

    async handle(_operation: 'count', args: unknown | undefined) {
        const validatedArgs = this.inputValidator.validateCountArgs(
            this.model,
            args
        );

        const modelDef = this.requireModel(this.model);

        let query = this.kysely.selectFrom((eb) => {
            // nested query for filtering and pagination
            let subQuery = eb
                .selectFrom(modelDef.dbTable)
                .selectAll()
                .where((eb1) =>
                    this.dialect.buildFilter(
                        eb1,
                        this.model,
                        modelDef.dbTable,
                        validatedArgs?.where
                    )
                );
            subQuery = this.dialect.buildSkipTake(
                subQuery,
                validatedArgs?.skip,
                validatedArgs?.take
            );
            return subQuery.as('$sub');
        });

        if (validatedArgs?.select && typeof validatedArgs.select === 'object') {
            // count with field selection
            query = query.select((eb) =>
                Object.keys(validatedArgs.select!).map((key) =>
                    key === '_all'
                        ? eb.cast(eb.fn.countAll(), 'integer').as('_all')
                        : eb
                              .cast(
                                  eb.fn.count(sql.ref(`$sub.${key}`)),
                                  'integer'
                              )
                              .as(key)
                )
            );

            return query.executeTakeFirstOrThrow();
        } else {
            // simple count all
            query = query.select((eb) =>
                eb.cast(eb.fn.countAll(), 'integer').as('count')
            );
            const result = await query.executeTakeFirstOrThrow();
            return (result as any).count as number;
        }
    }
}
