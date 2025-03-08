import { sql, type SelectQueryBuilder } from 'kysely';
import type { GetModels, SchemaDef } from '../../../schema';
import { QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import { buildFieldRef, isRelationField } from '../../query-utils';
import type { FindArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';
import { getCrudDialect } from '../dialects';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class FindOperationHandler<
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

    async handle(
        operation: CrudOperation,
        args: unknown,
        validateArgs = true
    ): Promise<unknown> {
        // parse args
        const parsedArgs = validateArgs
            ? this.inputValidator.validateFindArgs(
                  this.model,
                  operation === 'findUnique',
                  args
              )
            : (args as FindArgs<Schema, GetModels<Schema>, true>);

        // run query
        const result = await this.runQuery(this.model, operation, parsedArgs);

        const finalResult =
            operation === 'findMany' ? result : result[0] ?? null;
        return finalResult;
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
            query = query.where((eb) =>
                dialect.buildFilter(eb, model, modelDef.dbTable, args.where)
            );
        }

        // skip && take
        const skip = args?.skip;
        const take = operation === 'findMany' ? args?.take : 1;
        query = dialect.buildSkipTake(query, skip, take);

        // orderBy
        if (args?.orderBy) {
            query = dialect.buildOrderBy(query, modelDef.dbTable, args.orderBy);
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
