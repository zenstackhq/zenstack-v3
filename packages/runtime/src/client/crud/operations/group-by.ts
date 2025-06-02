import { sql } from 'kysely';
import { match } from 'ts-pattern';
import type { SchemaDef } from '../../../schema';
import { getField } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class GroupByeOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    async handle(_operation: 'groupBy', args: unknown | undefined) {
        const validatedArgs = this.inputValidator.validateGroupByArgs(
            this.model,
            args
        );

        let query = this.kysely.selectFrom((eb) => {
            // nested query for filtering and pagination

            // where
            let subQuery = eb
                .selectFrom(this.model)
                .selectAll()
                .where((eb1) =>
                    this.dialect.buildFilter(
                        eb1,
                        this.model,
                        this.model,
                        validatedArgs?.where
                    )
                );

            // skip & take
            const skip = validatedArgs?.skip;
            let take = validatedArgs?.take;
            let negateOrderBy = false;
            if (take !== undefined && take < 0) {
                negateOrderBy = true;
                take = -take;
            }
            subQuery = this.dialect.buildSkipTake(subQuery, skip, take);

            // default orderBy
            subQuery = this.dialect.buildOrderBy(
                subQuery,
                this.model,
                this.model,
                undefined,
                skip !== undefined || take !== undefined,
                negateOrderBy
            );

            return subQuery.as('$sub');
        });

        const bys =
            typeof validatedArgs.by === 'string'
                ? [validatedArgs.by]
                : (validatedArgs.by as string[]);

        query = query.groupBy(bys as any);

        // orderBy
        if (validatedArgs.orderBy) {
            query = this.dialect.buildOrderBy(
                query,
                this.model,
                '$sub',
                validatedArgs.orderBy,
                false,
                false
            );
        }

        if (validatedArgs.having) {
            query = query.having((eb1) =>
                this.dialect.buildFilter(
                    eb1,
                    this.model,
                    '$sub',
                    validatedArgs.having
                )
            );
        }

        // select all by fields
        for (const by of bys) {
            query = query.select(() => sql.ref(`$sub.${by}`).as(by));
        }

        // aggregations
        for (const [key, value] of Object.entries(validatedArgs)) {
            switch (key) {
                case '_count': {
                    if (value === true) {
                        query = query.select((eb) =>
                            eb.cast(eb.fn.countAll(), 'integer').as('_count')
                        );
                    } else {
                        Object.entries(value).forEach(([field, val]) => {
                            if (val === true) {
                                if (field === '_all') {
                                    query = query.select((eb) =>
                                        eb
                                            .cast(eb.fn.countAll(), 'integer')
                                            .as(`_count._all`)
                                    );
                                } else {
                                    query = query.select((eb) =>
                                        eb
                                            .cast(
                                                eb.fn.count(
                                                    sql.ref(`$sub.${field}`)
                                                ),
                                                'integer'
                                            )
                                            .as(`${key}.${field}`)
                                    );
                                }
                            }
                        });
                    }
                    break;
                }

                case '_sum':
                case '_avg':
                case '_max':
                case '_min': {
                    Object.entries(value).forEach(([field, val]) => {
                        if (val === true) {
                            query = query.select((eb) => {
                                const fn = match(key)
                                    .with('_sum', () => eb.fn.sum)
                                    .with('_avg', () => eb.fn.avg)
                                    .with('_max', () => eb.fn.max)
                                    .with('_min', () => eb.fn.min)
                                    .exhaustive();
                                return fn(sql.ref(`$sub.${field}`)).as(
                                    `${key}.${field}`
                                );
                            });
                        }
                    });
                    break;
                }
            }
        }

        const result = await query.execute();
        return result.map((row) => this.postProcessRow(row));
    }

    private postProcessRow(row: any) {
        const ret: any = {};

        // postprocess result to convert flat fields into nested objects
        for (const [key, value] of Object.entries(row)) {
            if (key === '_count') {
                ret[key] = value;
                continue;
            }
            const parts = key.split('.');
            if (parts.length < 2) {
                ret[key] = value;
                continue;
            }

            const op = parts[0]!;
            const field = [...parts.slice(1)].join('.');

            let val: any = value;
            if (typeof value === 'string') {
                const fieldDef = getField(this.schema, this.model, field);
                if (fieldDef) {
                    const type = fieldDef.type;
                    if (op === '_avg') {
                        val = parseFloat(val);
                    } else {
                        if (op === '_sum' || op === '_min' || op === '_max') {
                            val = match(type)
                                .with('Int', () => parseInt(value, 10))
                                .with('BigInt', () => BigInt(value))
                                .with('Float', () => parseFloat(value))
                                .with('Decimal', () => parseFloat(value))
                                .otherwise(() => value);
                        }
                    }
                }
            }

            ret[op] = {
                ...ret[op],
                [field]: val,
            };
        }

        return ret;
    }
}
