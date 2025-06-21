import { sql } from 'kysely';
import type { SchemaDef } from '../../../schema';
import { BaseOperationHandler } from './base';

export class CountOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(_operation: 'count', args: unknown | undefined) {
        const validatedArgs = this.inputValidator.validateCountArgs(this.model, args);

        let query = this.kysely.selectFrom((eb) => {
            // nested query for filtering and pagination
            let subQuery = eb
                .selectFrom(this.model)
                .selectAll()
                .where((eb1) => this.dialect.buildFilter(eb1, this.model, this.model, validatedArgs?.where));
            subQuery = this.dialect.buildSkipTake(subQuery, validatedArgs?.skip, validatedArgs?.take);
            return subQuery.as('$sub');
        });

        if (validatedArgs?.select && typeof validatedArgs.select === 'object') {
            // count with field selection
            query = query.select((eb) =>
                Object.keys(validatedArgs.select!).map((key) =>
                    key === '_all'
                        ? eb.cast(eb.fn.countAll(), 'integer').as('_all')
                        : eb.cast(eb.fn.count(sql.ref(`$sub.${key}`)), 'integer').as(key),
                ),
            );

            return query.executeTakeFirstOrThrow();
        } else {
            // simple count all
            query = query.select((eb) => eb.cast(eb.fn.countAll(), 'integer').as('count'));
            const result = await query.executeTakeFirstOrThrow();
            return (result as any).count as number;
        }
    }
}
