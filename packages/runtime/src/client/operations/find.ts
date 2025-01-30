import { Console, Effect } from 'effect';
import type { Kysely, SelectQueryBuilder } from 'kysely';
import { z, ZodSchema } from 'zod';
import type { SchemaDef } from '../../schema';
import { InternalError, QueryError } from '../errors';
import { getUniqueFields, requireModelEffect } from '../query-utils';
import { makeWhereSchema } from './parse';

type FindOperation = 'findMany' | 'findUnique' | 'findFirst';

export function runFind(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    operation: FindOperation,
    args: unknown
) {
    return Effect.runPromise(
        Effect.gen(function* () {
            // parse args
            const parsedArgs = yield* parseFindArgs(
                schema,
                model,
                operation,
                args
            );

            // run query
            const result = yield* runQuery(
                db,
                schema,
                model,
                operation,
                parsedArgs
            );
            yield* Console.log(`${operation} result:`, result);
            return result;
        })
    );
}

function parseFindArgs(
    schema: SchemaDef,
    model: string,
    operation: FindOperation,
    args: unknown
) {
    if (!args) {
        if (operation === 'findUnique') {
            // args is required for findUnique
            return Effect.fail(new QueryError(`Missing query args`));
        } else {
            return Effect.succeed(undefined);
        }
    }

    const baseWhere = makeWhereSchema(schema, model);
    let where: ZodSchema = baseWhere;

    if (operation === 'findUnique') {
        // findUnique requires at least one unique field (field set) is required

        const uniqueFields = getUniqueFields(schema, model);
        if (uniqueFields.length === 0) {
            return Effect.fail(
                new InternalError(`Model "${model}" has no unique fields`)
            );
        }

        if (uniqueFields.length === 1) {
            // only one unique field (set), mark the field(s) required
            where = baseWhere.required(
                uniqueFields[0]!.reduce(
                    (acc, k) => ({
                        ...acc,
                        [k.name]: true,
                    }),
                    {}
                )
            );
        } else {
            where = baseWhere.refine((value) => {
                // check that at least one unique field is set
                return uniqueFields.some((fields) =>
                    fields.every(({ name }) => value[name] !== undefined)
                );
            }, `At least one unique field or field set must be set`);
        }
    } else {
        // where clause is optional
        where = where.optional();
    }

    const findSchema = z.object({ where });

    return Effect.try({
        try: () => findSchema.parse(args),
        catch: (e) => new QueryError(`Invalid find args: ${e}`),
    });
}

function runQuery(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    operation: string,
    args: Effect.Effect.Success<ReturnType<typeof parseFindArgs>> | undefined
): Effect.Effect<any, QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);
        let query = db.selectFrom(modelDef.dbTable);
        query = query.selectAll();

        if (args?.where) {
            query = buildWhere(query, args.where);
        }

        // if (args.select) {
        //     query = query.select(
        //         Object.keys(args.select).filter(
        //             (f) =>
        //                 args.select![f] === true &&
        //                 (isScalarField(schema, model, f) ||
        //                     isForeignKeyField(schema, model, f))
        //         )
        //     );
        // } else {
        //     query = query.selectAll();
        // }

        const compiled = query.compile();
        yield* Console.log(
            `${operation} query:`,
            compiled.sql,
            compiled.parameters
        );

        const result = yield* Effect.tryPromise({
            try: () =>
                operation === 'findMany'
                    ? query.execute()
                    : query.executeTakeFirst(),
            catch: (e) => new QueryError(`Failed to execute query: ${e}`),
        });

        return result ?? null;
    });
}

function buildWhere(query: SelectQueryBuilder<any, string, {}>, where: any) {
    let result = query;
    if (!where) {
        return result;
    }

    result = Object.entries(where).reduce(
        (acc, [field, value]) => acc.where(field, '=', value),
        result
    );

    return result;
}
