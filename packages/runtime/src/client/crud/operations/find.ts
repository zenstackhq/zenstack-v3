import { sql, type SelectQueryBuilder } from 'kysely';
import type { z } from 'zod';
import type { GetModels, SchemaDef } from '../../../schema';
import { enumerate } from '../../../utils/enumerate';
import { QueryError } from '../../errors';
import { buildFieldRef, isRelationField } from '../../query-utils';
import type { FindArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';
import { getCrudDialect } from '../dialects';
import { BaseOperationHandler } from './base';

export class FindOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    async handle(operation: CrudOperation, args: unknown): Promise<unknown> {
        // parse args
        const parsedArgs = this.parseFindArgs(operation, args);

        // run query
        const result = await this.runQuery(this.model, operation, parsedArgs);

        const finalResult =
            operation === 'findMany' ? result : result[0] ?? null;
        return finalResult;
    }

    private parseFindArgs(operation: CrudOperation, args: unknown) {
        const findSchema = this.makeFindSchema(
            this.model,
            operation === 'findUnique',
            true
        );

        const { error } = findSchema.safeParse(args);
        if (error) {
            throw new QueryError(`Invalid find args: ${error.message}`);
        } else {
            // need to return the original args as zod may change the order
            // of fields during parse, and order is critical for query parts
            // like `orderBy`
            return args as z.infer<typeof findSchema>;
        }
    }

    async runQuery(
        model: string,
        operation: CrudOperation,
        args: FindArgs<Schema, GetModels<Schema>, true> | undefined
    ) {
        const modelDef = this.requireModel(model);

        // table
        let query = this.kysely.selectFrom(`${modelDef.dbTable}` as any);
        const dialect = getCrudDialect(this.schema, this.options);

        // where
        if (args?.where) {
            query = dialect.buildWhere(
                query,
                model,
                modelDef.dbTable,
                args.where
            );
        }

        // skip && take
        const skip = args?.skip;
        const take = operation === 'findMany' ? args?.take : 1;
        query = dialect.buildSkipTake(query, skip, take);

        // orderBy
        if (args?.orderBy) {
            enumerate(args.orderBy).forEach((orderBy) => {
                for (const [field, value] of Object.entries(orderBy)) {
                    if (value === 'asc' || value === 'desc') {
                        query = query.orderBy(
                            this.kysely.dynamic.ref(field),
                            value
                        );
                    } else if (
                        value &&
                        typeof value === 'object' &&
                        'nulls' in value &&
                        'sort' in value &&
                        (value.sort === 'asc' || value.sort === 'desc') &&
                        (value.nulls === 'first' || value.nulls === 'last')
                    ) {
                        query = query.orderBy(
                            this.kysely.dynamic.ref(field),
                            sql.raw(`${value.sort} nulls ${value.nulls}`)
                        );
                    } else {
                        throw new QueryError(`Invalid orderBy value: ${value}`);
                    }
                }
            });
        }

        // select
        if (args?.select) {
            query = this.buildFieldSelection(
                model,
                operation,
                query,
                args?.select,
                modelDef.dbTable
            );
        } else {
            query = this.buildSelectAllScalarFields(model, query);
        }

        // include
        if (args?.include) {
            query = this.buildFieldSelection(
                model,
                operation,
                query,
                args?.include,
                modelDef.dbTable
            );
        }

        try {
            return await query.execute();
        } catch (err) {
            const { sql, parameters } = query.compile();
            throw new QueryError(
                `Failed to execute query: ${err}, sql: ${sql}, parameters: ${parameters}`
            );
        }
    }

    private buildFieldSelection(
        model: string,
        operation: CrudOperation,
        query: SelectQueryBuilder<any, any, {}>,
        selectOrInclude: Record<string, any>,
        parentAlias: string
    ) {
        let result = query;

        for (const [field, payload] of Object.entries(selectOrInclude)) {
            if (!payload) {
                continue;
            }
            const fieldDef = this.requireField(model, field);
            if (!fieldDef.relation) {
                result = this.selectField(result, model, parentAlias, field);
            } else {
                if (!fieldDef.array && !fieldDef.optional && payload.where) {
                    throw new QueryError(
                        `Field "${field}" doesn't support filtering`
                    );
                }
                const dialect = getCrudDialect(this.schema, this.options);
                result = dialect.buildRelationSelection(
                    result,
                    model,
                    operation,
                    field,
                    parentAlias,
                    payload
                );
            }
        }

        return result;
    }

    private buildSelectAllScalarFields(
        model: string,
        query: SelectQueryBuilder<any, any, {}>
    ) {
        let result = query;
        const modelDef = this.requireModel(model);
        return Object.keys(modelDef.fields)
            .filter((f) => !isRelationField(this.schema, model, f))
            .reduce(
                (acc, f) => this.selectField(acc, model, modelDef.dbTable, f),
                result
            );
    }

    private selectField(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        table: string,
        field: string
    ) {
        const fieldDef = this.requireField(model, field);
        if (!fieldDef.computed) {
            return query.select(sql.ref(`${table}.${field}`).as(field));
        } else {
            return query.select((eb) =>
                buildFieldRef(this.schema, model, field, this.options, eb).as(
                    field
                )
            );
        }
    }
}
