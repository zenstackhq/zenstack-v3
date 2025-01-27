import { createId } from '@paralleldrive/cuid2';
import { Console, Effect, Match, Schema } from 'effect';
import type { Kysely } from 'kysely';
import * as uuid from 'uuid';
import { type FieldGenerators, type SchemaDef } from '../../schema';
import { clone } from '../../utils';
import { InternalError, QueryError } from '../errors';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
    requireModelEffect,
} from '../query-utils';

const CreateArgsSchema = Schema.Struct({
    data: Schema.Object,
    select: Schema.optionalWith(Schema.Object, { exact: true }),
    include: Schema.optionalWith(Schema.Object, { exact: true }),
});

type CreateArgs = Schema.Schema.Type<typeof CreateArgsSchema>;

const RelationPayloadSchema = Schema.Union(
    Schema.Struct({
        create: Schema.Object,
    }),
    Schema.Struct({
        connect: Schema.Object,
    }),
    Schema.Struct({
        connectOrCreate: Schema.Object,
    }),
    Schema.Struct({
        createMany: Schema.Object,
    })
);

export function runCreate(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    args: unknown
) {
    return Effect.runPromise(
        Effect.gen(function* () {
            // validate args
            const validatedArgs = yield* validateArgs(args);

            // build query
            const result = yield* runQuery(db, schema, model, validatedArgs);
            yield* Console.log('Create result:', result);
            return result;
        })
    );
}

function validateArgs(args: unknown) {
    return Schema.decodeUnknown(CreateArgsSchema)(args);
}

function runQuery(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    args: CreateArgs
) {
    return Effect.gen(function* () {
        const hasRelation = Object.keys(args.data).some(
            (f) => !!requireField(schema, model, f).relation
        );

        let result: any;
        if (hasRelation) {
            // employ a transaction
            result = yield* Effect.tryPromise({
                try: () =>
                    db
                        .transaction()
                        .setIsolationLevel('repeatable read')
                        .execute(async (trx) =>
                            Effect.runPromise(
                                doCreate(trx, schema, model, args.data)
                            )
                        ),
                catch: (e) => {
                    console.error(`Error during create: ${e}`);
                    return e;
                },
            });
        } else {
            // simple create
            result = yield* doCreate(db, schema, model, args.data);
        }

        return assembleResult(result, args);
    });
}

function doCreate(
    db: Kysely<any>,
    schema: SchemaDef,
    model: string,
    payload: object
): Effect.Effect<any, QueryError, never> {
    return Effect.gen(function* () {
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

        const updatedData = yield* fillGeneratedValues(
            schema,
            model,
            regularFields
        );
        const query = db.insertInto(model).values(updatedData).returningAll();
        yield* Console.log('Create query:', query.compile());
        const created = yield* Effect.tryPromise(() =>
            query.execute().then((created) => created[0]!)
        );

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

                        const subPayload = yield* Schema.decodeUnknown(
                            RelationPayloadSchema
                        )(payload);

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

            // const relationResults = yield* Effect.all(relationEffects);
            // return assembleResult(created, relationResults);
            yield* Effect.all(relationEffects);
            return created;
        }
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

function fillGeneratedValues(schema: SchemaDef, model: string, data: object) {
    return Effect.gen(function* () {
        const modelDef = yield* requireModelEffect(schema, model);
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

function isScalarField(
    schema: SchemaDef,
    model: string,
    field: string
): boolean {
    const fieldDef = requireField(schema, model, field);
    return !fieldDef.relation && !fieldDef.foreignKeyFor;
}

function isForeignKeyField(
    schema: SchemaDef,
    model: string,
    field: string
): boolean {
    const fieldDef = requireField(schema, model, field);
    return !!fieldDef.foreignKeyFor;
}

function assembleResult(primaryData: any, _args: CreateArgs) {
    return primaryData;
}
