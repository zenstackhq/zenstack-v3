import { createId } from '@paralleldrive/cuid2';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import * as uuid from 'uuid';
import { z, ZodSchema } from 'zod';
import {
    type BuiltinType,
    type FieldDef,
    type FieldGenerators,
    type GetModels,
    type ModelDef,
    type SchemaDef,
} from '../../schema/schema';
import { clone } from '../../utils/clone';
import { enumerate } from '../../utils/enumerate';
import { QueryError } from '../errors';
import {
    fieldHasDefaultValue,
    getIdValues,
    getRelationForeignKeyFieldPairs,
    isForeignKeyField,
    isScalarField,
    requireField,
    requireModel,
} from '../query-utils';
import { exists } from './common';
import type { OperationContext } from './context';
import { getQueryDialect } from './dialect';
import { runQuery as runFindQuery } from './find';
import { makePrimitiveSchema, makeWhereSchema, orArray } from './parse';

type CreateArgs = z.infer<ReturnType<typeof makeCreateSchema>>;

function makeCreateSchema<Schema extends SchemaDef>(
    schema: Schema,
    model: string
) {
    const dataSchema = makeCreateDataSchema<Schema>(schema, model, false);
    return z
        .object({
            data: dataSchema,
            select: z.record(z.string(), z.any()).optional(),
            include: z.record(z.string(), z.any()).optional(),
        })
        .strict();
}

function makeCreateDataSchema<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    canBeArray: boolean,
    withoutFields: string[] = [],
    withoutRelationFields = false
) {
    const modelDef = requireModel(schema, model);
    const regularAndFkFields: any = {};
    const regularAndRelationFields: any = {};
    const hasRelation = Object.values(modelDef.fields).some((f) => f.relation);

    Object.keys(modelDef.fields).forEach((field) => {
        if (withoutFields.includes(field)) {
            return;
        }
        const fieldDef = requireField(schema, model, field);

        if (fieldDef.relation) {
            if (withoutRelationFields) {
                return;
            }
            const excludeFields: string[] = [];
            const oppositeField = fieldDef.relation.opposite;
            if (oppositeField) {
                excludeFields.push(oppositeField);
                const oppositeFieldDef = requireField(
                    schema,
                    fieldDef.type,
                    oppositeField
                );
                if (oppositeFieldDef.relation?.fields) {
                    excludeFields.push(...oppositeFieldDef.relation.fields);
                }
            }
            let fieldSchema: ZodSchema = z.lazy(() =>
                makeRelationSchema(schema, fieldDef, excludeFields)
            );
            if (fieldDef.optional || fieldDef.array) {
                fieldSchema = fieldSchema.optional();
            }
            regularAndRelationFields[field] = fieldSchema;
        } else {
            let fieldSchema: ZodSchema = makePrimitiveSchema(fieldDef.type);
            if (fieldDef.optional || fieldHasDefaultValue(fieldDef)) {
                fieldSchema = fieldSchema.optional();
            }

            regularAndFkFields[field] = fieldSchema;
            if (!fieldDef.foreignKeyFor) {
                regularAndRelationFields[field] = fieldSchema;
            }
        }
    });

    if (!hasRelation) {
        return orArray(z.object(regularAndFkFields).strict(), canBeArray);
    } else {
        return z.union([
            z.object(regularAndFkFields).strict(),
            z.object(regularAndRelationFields).strict(),
            ...(canBeArray
                ? [z.array(z.object(regularAndFkFields).strict())]
                : []),
            ...(canBeArray
                ? [z.array(z.object(regularAndRelationFields).strict())]
                : []),
        ]);
    }
}

function makeRelationSchema<Schema extends SchemaDef>(
    schema: Schema,
    fieldDef: FieldDef,
    withoutFields: string[]
) {
    return z
        .object({
            create: makeCreateDataSchema(
                schema,
                fieldDef.type,
                !!fieldDef.array,
                withoutFields
            ).optional(),

            connect: makeConnectDataSchema(
                schema,
                fieldDef.type,
                !!fieldDef.array
            ).optional(),

            connectOrCreate: makeConnectOrCreateDataSchema(
                schema,
                fieldDef.type,
                !!fieldDef.array,
                withoutFields
            ).optional(),

            createMany: makeCreateManyDataSchema(
                schema,
                fieldDef,
                []
            ).optional(),
        })
        .strict()
        .refine(
            (v) => Object.keys(v).length > 0,
            'At least one action is required'
        );
}

function makeConnectDataSchema<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    canBeArray: boolean
) {
    return orArray(makeWhereSchema(schema, model, true), canBeArray);
}

function makeConnectOrCreateDataSchema<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    canBeArray: boolean,
    withoutFields: string[]
) {
    const whereSchema = makeWhereSchema(schema, model, true);
    const createSchema = makeCreateDataSchema(
        schema,
        model,
        false,
        withoutFields
    );
    return orArray(
        z
            .object({
                where: whereSchema,
                create: createSchema,
            })
            .strict(),
        canBeArray
    );
}

function makeCreateManyDataSchema<Schema extends SchemaDef>(
    schema: Schema,
    fieldDef: FieldDef,
    withoutFields: string[]
) {
    return z
        .object({
            data: makeCreateDataSchema(
                schema,
                fieldDef.type,
                false,
                withoutFields,
                true
            ),
            skipDuplicates: z.boolean().optional(),
        })
        .strict();
}

export async function runCreate<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    args: unknown
) {
    // parse args
    const createSchema = makeCreateSchema(context.schema, context.model);
    const { data: parsedArgs, error } = createSchema.safeParse(args);
    if (error) {
        throw new QueryError(`Invalid create args: ${error}`);
    }
    return runQuery(context, parsedArgs);
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
    payload: object,
    parentModel?: string,
    parentField?: string,
    parentEntity?: any
) {
    const queryDialect = getQueryDialect(context.schema.provider);
    const modelDef = requireModel(context.schema, context.model);
    const result: any[] = [];

    let parentFkFields: any = {};
    if (parentModel && parentField && parentEntity) {
        parentFkFields = buildFkAssignments(
            context.schema,
            parentModel,
            parentField,
            parentEntity
        );
    }

    for (const item of enumerate(payload)) {
        const createFields: any = { ...parentFkFields };
        const postCreateRelations: Record<string, object> = {};
        for (const field in item) {
            const fieldDef = requireField(context.schema, context.model, field);
            if (
                isScalarField(context.schema, context.model, field) ||
                isForeignKeyField(context.schema, context.model, field)
            ) {
                createFields[field] = queryDialect.transformPrimitive(
                    (item as any)[field],
                    fieldDef.type as BuiltinType
                );
            } else {
                if (
                    fieldDef.relation?.fields &&
                    fieldDef.relation?.references
                ) {
                    const fkValues = await processOwnedRelation(
                        context,
                        fieldDef,
                        (item as any)[field]
                    );
                    for (let i = 0; i < fieldDef.relation.fields.length; i++) {
                        createFields[fieldDef.relation.fields[i]!] =
                            fkValues[fieldDef.relation.references[i]!];
                    }
                } else {
                    const subPayload = (item as any)[field];
                    if (subPayload && typeof subPayload === 'object') {
                        postCreateRelations[field] = subPayload;
                    }
                }
            }
        }

        const updatedData = fillGeneratedValues(modelDef, createFields);
        const query = context.kysely
            .insertInto(modelDef.dbTable as any)
            .values(updatedData)
            .returningAll();

        let createdEntity: any;

        try {
            createdEntity = await query
                .execute()
                .then((created) => created[0]!);
        } catch (err) {
            const { sql, parameters } = query.compile();
            throw new QueryError(
                `Error during create: ${err}, sql: ${sql}, parameters: ${parameters}`
            );
        }

        if (Object.keys(postCreateRelations).length === 0) {
            result.push(createdEntity);
        } else {
            const relationPromises = Object.entries(postCreateRelations).map(
                ([field, subPayload]) => {
                    return processNoneOwnedRelation(
                        context,
                        field,
                        subPayload,
                        createdEntity
                    );
                }
            );

            // await relation creation
            await Promise.all(relationPromises);

            result.push(createdEntity);
        }
    }

    if (Array.isArray(payload)) {
        return result;
    } else {
        return result[0];
    }
}

function buildFkAssignments<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    relationField: string,
    entity: any
) {
    const parentFkFields: any = {};

    invariant(
        relationField,
        'parentField must be defined if parentModel is defined'
    );
    invariant(entity, 'parentEntity must be defined if parentModel is defined');

    const { keyPairs } = getRelationForeignKeyFieldPairs(
        schema,
        model,
        relationField
    );

    for (const pair of keyPairs) {
        if (!(pair.pk in entity)) {
            throw new QueryError(
                `Field "${pair.pk}" not found in parent created data`
            );
        }
        Object.assign(parentFkFields, {
            [pair.fk]: (entity as any)[pair.pk],
        });
    }
    return parentFkFields;
}

async function processOwnedRelation<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    relationField: FieldDef,
    payload: any
) {
    if (!payload) {
        return;
    }

    let result: any;
    const relationModel = relationField.type as GetModels<Schema>;

    for (const [action, subPayload] of Object.entries<any>(payload)) {
        if (!subPayload) {
            continue;
        }
        switch (action) {
            case 'create': {
                const created = await doCreate(
                    {
                        ...context,
                        model: relationModel,
                    },
                    subPayload
                );
                // extract id fields and return as foreign key values
                result = getIdValues(
                    context.schema,
                    relationField.type,
                    created
                );
                break;
            }

            case 'connect': {
                // directly return the payload as foreign key values
                result = subPayload;
                break;
            }

            case 'connectOrCreate': {
                const found = await exists(
                    context.kysely,
                    context.schema,
                    relationModel,
                    subPayload.where
                );
                if (!found) {
                    // create
                    const created = await doCreate(
                        { ...context, model: relationModel },
                        subPayload.create
                    );
                    result = getIdValues(
                        context.schema,
                        relationField.type,
                        created
                    );
                } else {
                    // connect
                    result = found;
                }
                break;
            }

            default:
                throw new QueryError(`Invalid relation action: ${action}`);
        }
    }

    return result;
}

function processNoneOwnedRelation<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    relationFieldName: string,
    payload: any,
    parentEntity: any
) {
    const relationFieldDef = requireField(
        context.schema,
        context.model,
        relationFieldName
    );
    const relationModel = relationFieldDef.type as GetModels<Schema>;
    const tasks: Promise<unknown>[] = [];

    for (const [action, subPayload] of Object.entries<any>(payload)) {
        if (!subPayload) {
            continue;
        }
        switch (action) {
            case 'create': {
                // create with a parent entity
                tasks.push(
                    doCreate(
                        {
                            ...context,
                            model: relationModel,
                        },
                        subPayload,
                        context.model,
                        relationFieldName,
                        parentEntity
                    )
                );
                break;
            }

            case 'connect': {
                tasks.push(
                    connectToEntity<Schema>(
                        {
                            ...context,
                            model: relationModel,
                        },
                        subPayload,
                        context.model,
                        relationFieldName,
                        parentEntity
                    )
                );
                break;
            }

            case 'connectOrCreate': {
                tasks.push(
                    exists(
                        context.kysely,
                        context.schema,
                        relationModel,
                        subPayload.where
                    ).then((found) =>
                        !found
                            ? doCreate(
                                  {
                                      ...context,
                                      model: relationModel,
                                  },
                                  subPayload.create,
                                  context.model,
                                  relationFieldName,
                                  parentEntity
                              )
                            : connectToEntity<Schema>(
                                  {
                                      ...context,
                                      model: relationModel,
                                  },
                                  found,
                                  context.model,
                                  relationFieldName,
                                  parentEntity
                              )
                    )
                );
                break;
            }

            default:
                throw new QueryError(`Invalid relation action: ${action}`);
        }
    }

    return Promise.all(tasks);
}

async function connectToEntity<Schema extends SchemaDef>(
    context: OperationContext<Schema>,
    targetEntityUniqueFilter: any,
    parentModel: string,
    parentFieldName: string,
    parentEntity: any
) {
    const modelDef = requireModel(context.schema, context.model);
    const fkAssignments = buildFkAssignments(
        context.schema,
        parentModel,
        parentFieldName,
        parentEntity
    );

    return Promise.all(
        enumerate(targetEntityUniqueFilter).map(async (itemFilter) => {
            const query = context.kysely
                .updateTable(modelDef.dbTable as GetModels<Schema>)
                .where((eb) => eb.and(itemFilter))
                .set(fkAssignments);
            await query.execute();
        })
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
