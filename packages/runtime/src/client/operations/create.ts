import { createId } from '@paralleldrive/cuid2';
import { match } from 'ts-pattern';
import * as uuid from 'uuid';
import { z } from 'zod';
import {
    type BuiltinType,
    type FieldGenerators,
    type GetModels,
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
    requireModel,
} from '../query-utils';
import type { OperationContext } from './context';
import { getQueryDialect } from './dialect';
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

export async function runCreate<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: unknown
) {
    // parse args
    const parsedArgs = parseCreateArgs(args);
    return runQuery(context, parsedArgs);
}

function parseCreateArgs(args: unknown) {
    const { data, error } = CreateArgsSchema.safeParse(args);
    if (error) {
        throw new QueryError(`Invalid create args: ${error}`);
    } else {
        return data;
    }
}

async function runQuery<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: CreateArgs
) {
    const hasRelationCreate = Object.keys(args.data).some(
        (f) => !!requireField(context.schema, context.model, f).relation
    );

    const returnRelations = needReturnRelations(
        context.schema,
        context.model,
        args
    );

    let result: any;
    if (hasRelationCreate || returnRelations) {
        // employ a transaction
        try {
            result = await context.kysely
                .transaction()
                .setIsolationLevel('repeatable read')
                .execute(async (trx) => {
                    const createResult = await doCreate(
                        { ...context, kysely: trx },
                        args.data
                    );
                    return readBackResult(
                        { ...context, kysely: trx },
                        createResult,
                        args
                    );
                });
        } catch (err) {
            throw new QueryError(`Error during create: ${err}`);
        }
    } else {
        // simple create
        const createResult = await doCreate(context, args.data);
        result = trimResult(createResult, args);
    }

    return result;
}

async function doCreate<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    payload: object
) {
    const queryDialect = getQueryDialect(context.schema.provider);
    const modelDef = requireModel(context.schema, context.model);

    // separate args.data into scalar fields and relation fields
    const regularFields: any = {};
    const relationFields: any = {};
    for (const field in payload) {
        if (
            isScalarField(context.schema, context.model, field) ||
            isForeignKeyField(context.schema, context.model, field)
        ) {
            const fieldDef = requireField(context.schema, context.model, field);
            regularFields[field] = queryDialect.transformPrimitive(
                (payload as any)[field],
                fieldDef.type as BuiltinType
            );
        } else {
            relationFields[field] = (payload as any)[field];
        }
    }

    const updatedData = fillGeneratedValues(modelDef, regularFields);
    const query = context.kysely
        .insertInto(modelDef.dbTable as any)
        .values(updatedData)
        .returningAll();

    let created: any;

    try {
        created = await query.execute().then((created) => created[0]!);
    } catch (err) {
        const { sql, parameters } = query.compile();
        throw new QueryError(
            `Error during create: ${err}, sql: ${sql}, parameters: ${parameters}`
        );
    }

    if (Object.keys(relationFields).length === 0) {
        return created;
    } else {
        const relationPromises = Object.entries(relationFields).map(
            ([field, payload]) => {
                if (!payload) {
                    throw new QueryError(
                        `Invalid payload for relation "${field}"`
                    );
                }

                const subPayload = parseRelationPayload(payload, field);

                if ('create' in subPayload) {
                    return doNestedCreate(
                        context,
                        field,
                        created,
                        subPayload.create
                    );
                } else {
                    throw new InternalError('Not implemented');
                }
            }
        );

        // await relation creation
        await Promise.all(relationPromises);

        return created;
    }
}

function parseRelationPayload(payload: {}, field: string) {
    const { data, error } = RelationPayloadSchema.safeParse(payload);
    if (error) {
        throw new QueryError(
            `Invalid payload for relation "${field}": ${error}`
        );
    } else {
        return data;
    }
}

async function doNestedCreate<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    field: string,
    parentEntity: { [x: string]: any },
    subPayload: any
) {
    const fieldDef = requireField(context.schema, context.model, field);
    const { keyPairs } = getRelationForeignKeyFieldPairs(
        context.schema,
        context.model,
        field
    );

    for (const pair of keyPairs) {
        if (!(pair.pk in parentEntity)) {
            throw new QueryError(
                `Field "${pair.pk}" not found in parent created data`
            );
        }
        Object.assign(subPayload, {
            [pair.fk]: (parentEntity as any)[pair.pk],
        });
    }
    return doCreate(
        { ...context, model: fieldDef.type as GetModels<Schema> },
        subPayload
    );
}

function fillGeneratedValues(modelDef: ModelDef, data: object) {
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
}

function evalGenerator(generator: FieldGenerators) {
    return match(generator)
        .with('cuid', 'cuid2', () => createId())
        .with('uuid4', () => uuid.v4())
        .with('uuid7', () => uuid.v7())
        .with('nanoid', () => uuid.v7())
        .otherwise(() => undefined);
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

async function readBackResult<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    primaryData: any,
    args: CreateArgs
) {
    // fetch relations based on include or select
    const read = await runFindQuery(context, {
        where: getIdValues(context.schema, context.model, primaryData),
        select: args.select,
        include: args.include,
    });
    return read[0] ?? null;
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
