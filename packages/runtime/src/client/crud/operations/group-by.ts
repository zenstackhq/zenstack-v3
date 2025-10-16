import { match } from 'ts-pattern';
import type { SchemaDef } from '../../../schema';
import { aggregate, getField } from '../../query-utils';
import { BaseOperationHandler } from './base';

export class GroupByOperationHandler<Schema extends SchemaDef> extends BaseOperationHandler<Schema> {
    async handle(_operation: 'groupBy', args: unknown | undefined) {
        // normalize args to strip `undefined` fields
        const normalizedArgs = this.normalizeArgs(args);

        // parse args
        const parsedArgs = this.inputValidator.validateGroupByArgs(this.model, normalizedArgs);

        let query = this.kysely.selectFrom((eb) => {
            // nested query for filtering and pagination

            // where
            let subQuery = eb
                .selectFrom(this.model)
                .selectAll()
                .where(() => this.dialect.buildFilter(this.model, this.model, parsedArgs?.where));

            // skip & take
            const skip = parsedArgs?.skip;
            let take = parsedArgs?.take;
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
                negateOrderBy,
            );

            return subQuery.as('$sub');
        });

        const fieldRef = (field: string) => this.dialect.fieldRef(this.model, field, '$sub');

        // groupBy
        const bys = typeof parsedArgs.by === 'string' ? [parsedArgs.by] : (parsedArgs.by as string[]);
        query = query.groupBy(bys.map((by) => fieldRef(by)));

        // orderBy
        if (parsedArgs.orderBy) {
            query = this.dialect.buildOrderBy(query, this.model, '$sub', parsedArgs.orderBy, false, false);
        }

        if (parsedArgs.having) {
            query = query.having(() => this.dialect.buildFilter(this.model, '$sub', parsedArgs.having));
        }

        // select all by fields
        for (const by of bys) {
            query = query.select(() => fieldRef(by).as(by));
        }

        // aggregations
        for (const [key, value] of Object.entries(parsedArgs)) {
            switch (key) {
                case '_count': {
                    if (value === true) {
                        query = query.select((eb) => eb.cast(eb.fn.countAll(), 'integer').as('_count'));
                    } else {
                        Object.entries(value).forEach(([field, val]) => {
                            if (val === true) {
                                if (field === '_all') {
                                    query = query.select((eb) =>
                                        eb.cast(eb.fn.countAll(), 'integer').as(`_count._all`),
                                    );
                                } else {
                                    query = query.select((eb) =>
                                        eb.cast(eb.fn.count(fieldRef(field)), 'integer').as(`${key}.${field}`),
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
                            query = query.select((eb) => aggregate(eb, fieldRef(field), key).as(`${key}.${field}`));
                        }
                    });
                    break;
                }
            }
        }

        const result = await this.executeQuery(this.kysely, query, 'groupBy');
        return result.rows.map((row) => this.postProcessRow(row));
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
