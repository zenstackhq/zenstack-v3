import { createId } from '@paralleldrive/cuid2';
import { Console, Effect, Match } from 'effect';
import type { Kysely } from 'kysely';
import * as uuid from 'uuid';
import { z } from 'zod';
import {
    type FieldGenerators,
    type ModelDef,
    type SchemaDef,
} from '../../schema/schema';
import { clone } from '../../utils/clone';
import { InternalError, QueryError } from '../errors';
import {
    getIdValues,
    getRelationForeignKeyFieldPairs,
    isForeignKeyField,
    isScalarField,
    requireField,
    requireModelEffect,
} from '../query-utils';
import type { OperationContext } from './context';
import { runQuery as runFindQuery } from './find';

const CreateArgsSchema = z.object({
    data: z.record(z.string(), z.any()),
    select: z.record(z.string(), z.any()).optional(),
    include: z.record(z.string(), z.any()).optional(),
});

type CreateArgs = z.infer<typeof CreateArgsSchema>;

const RelationPayloadSchema = z.union([
    z.object({ create: z.record(z.string(), z.any()) }),
    z.object({ connect: z.record(z.string(), z.any()) }),
    z.object({ connectOrCreate: z.record(z.string(), z.any()) }),
    z.object({ createMany: z.record(z.string(), z.any()) }),
]);

export function runCreate(
    { db, schema, model }: OperationContext,
    args: unknown
) {
    return Effect.runPromise(
        Effect.gen(function* () {
            // parse args
            const parsedArgs = yield* parseCreateArgs(args);

            const result = yield* runQuery(db, schema, model, parsedArgs);
            yield* Console.log('create result:', result);
            return result;
        })
    );
}

function parseCreateArgs(args: unknown) {
    return Effect.try({
        try: () => CreateArgsSchema.parse(args),
        catch: (e) => new QueryError(`Invalid create args: ${e}`),
    });
}

function runQuery(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    args: CreateArgs
) {
    return Effect.gen(function* () {
        const hasRelationCreate = Object.keys(args.data).some(
            (f) => !!requireField(schema, model, f).relation
        );

        const returnRelations = needReturnRelations(schema, model, args);

        let result: any;
        if (hasRelationCreate || returnRelations) {
            // employ a transaction
            result = yield* Effect.tryPromise({
                try: () =>
                    db
                        .transaction()
                        .setIsolationLevel('repeatable read')
                        .execute(async (trx) =>
                            Effect.runPromise(
                                Effect.gen(function* () {
                                    const createResult = yield* doCreate(
                                        trx,
                                        schema,
                                        model,
                                        args.data
                                    );
                                    return yield* readBackResult(
                                        trx,
                                        schema,
                                        model,
                                        createResult,
                                        args
                                    );
                                })
                            )
                        ),
                catch: (e) => new QueryError(`Error during create: ${e}`),
            });
        } else {
            // simple create
            const createResult = yield* doCreate(db, schema, model, args.data);
            result = trimResult(createResult, args);
        }

        return result;
    });
}

function doCreate(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    payload: object
): Effect.Effect<any, QueryError, never> {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);
        // separate args.data into scalar fields and relation fields
        const regularFields: any = {};
        const relationFields: any = {};
        for (const field in payload) {
            if (
                isScalarField(schema, model, field) ||
                isForeignKeyField(schema, model, field)
            ) {
                regularFields[field] = (payload as any)[field];
            } else {
                relationFields[field] = (payload as any)[field];
            }
        }

        const updatedData = yield* fillGeneratedValues(modelDef, regularFields);
        const query = db
            .insertInto(modelDef.dbTable)
            .values(updatedData)
            .returningAll();
        const compiled = query.compile();
        yield* Console.log('Create query:', compiled.sql, compiled.parameters);
        const created = yield* Effect.tryPromise({
            try: () => query.execute().then((created) => created[0]!),
            catch: (e) => new QueryError(`Error during create: ${e}`),
        });

        if (Object.keys(relationFields).length === 0) {
            return created;
        } else {
            const relationEffects = Object.entries(relationFields).map(
                ([field, payload]) =>
                    Effect.gen(function* () {
                        if (!payload) {
                            throw new QueryError(
                                `Invalid payload for relation "${field}"`
                            );
                        }

                        const subPayload = yield* parseRelationPayload(
                            payload,
                            field
                        );

                        const r = yield* Match.value(subPayload).pipe(
                            Match.when(
                                (v) => 'create' in v,
                                (v) =>
                                    doNestedCreate(
                                        db,
                                        schema,
                                        model,
                                        field,
                                        created,
                                        v.create
                                    )
                            ),
                            Match.orElse(() =>
                                Effect.fail(
                                    new InternalError('Not implemented')
                                )
                            )
                        );
                        return { [field]: r };
                    })
            );

            yield* Effect.all(relationEffects);
            return created;
        }
    });
}

function parseRelationPayload(payload: {}, field: string) {
    return Effect.try({
        try: () => RelationPayloadSchema.parse(payload),
        catch: (e) =>
            new QueryError(`Invalid payload for relation "${field}": ${e}`),
    });
}

function doNestedCreate(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    field: string,
    parentEntity: { [x: string]: any },
    subPayload: any
) {
    const fieldDef = requireField(schema, model, field);
    const fieldPairs = getRelationForeignKeyFieldPairs(schema, model, field);

    for (const pair of fieldPairs) {
        if (!(pair.pk in parentEntity)) {
            throw new QueryError(
                `Field "${pair.pk}" not found in parent created data`
            );
        }
        Object.assign(subPayload, {
            [pair.fk]: (parentEntity as any)[pair.pk],
        });
    }
    return doCreate(db, schema, fieldDef.type, subPayload);
}

function fillGeneratedValues(modelDef: ModelDef, data: object) {
    return Effect.gen(function* () {
        const fields = modelDef.fields;
        const values: any = clone(data);
        for (const field in fields) {
            if (!(field in data)) {
                if (fields[field]?.generator !== undefined) {
                    const generated = evalGenerator(fields[field].generator);
                    if (generated) {
                        values[field] = generated;
                    }
                } else if (fields[field]?.updatedAt) {
                    values[field] = new Date().toISOString();
                }
            }
        }
        return values;
    });
}

function evalGenerator(generator: FieldGenerators) {
    return Match.value(generator).pipe(
        Match.whenOr('cuid', 'cuid2', () => createId()),
        Match.when('uuid4', () => uuid.v4()),
        Match.when('uuid7', () => uuid.v7()),
        Match.when('nanoid', () => uuid.v7()),
        Match.orElse(() => undefined)
    );
}

function trimResult(data: any, args: CreateArgs) {
    if (!args.select) {
        return data;
    }
    return Object.keys(args.select).reduce((acc, field) => {
        acc[field] = data[field];
        return acc;
    }, {} as any);
}

function readBackResult(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    primaryData: any,
    args: CreateArgs
) {
    return Effect.gen(function* () {
        // fetch relations based on include or select
        const read = yield* runFindQuery(db, schema, model, 'findUnique', {
            where: getIdValues(schema, model, primaryData),
            select: args.select,
            include: args.include,
        });
        return read[0] ?? null;
    });
}

function needReturnRelations(
    schema: SchemaDef,
    model: string,
    args: CreateArgs
) {
    let returnRelation = false;

    if (args.include) {
        returnRelation = Object.keys(args.include).length > 0;
    } else if (args.select) {
        returnRelation = Object.entries(args.select).some(([K, v]) => {
            const fieldDef = requireField(schema, model, K);
            return fieldDef.relation && v;
        });
    }
    return returnRelation;
}
