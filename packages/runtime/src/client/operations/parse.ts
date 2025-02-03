import { Match } from 'effect';
import { z, ZodObject, ZodSchema } from 'zod';
import type { SchemaDef } from '../../schema/schema';
import { requireField, requireModel } from '../query-utils';

const schemas = new Map<string, ZodSchema>();

type SchemaKinds = 'where' | 'select' | 'include';

function getCache(model: string, kind: SchemaKinds) {
    return schemas.get(`${model}:${kind}`);
}

function putCache(model: string, kind: SchemaKinds, schema: ZodSchema) {
    schemas.set(`${model}:${kind}`, schema);
}

export function makeWhereSchema(
    schema: SchemaDef,
    model: string
): ZodObject<any> {
    let result = getCache(model, 'where') as ZodObject<any> | undefined;
    if (result) {
        return result;
    }

    const modelDef = requireModel(schema, model);
    const fields: Record<string, any> = {};
    for (const field of Object.keys(modelDef.fields)) {
        const fieldDef = requireField(schema, model, field);
        if (fieldDef.relation) {
            fields[field] = z.lazy(() =>
                makeWhereSchema(schema, fieldDef.type).optional()
            );
        } else {
            fields[field] = makePrimitiveSchema(fieldDef.type).optional();
        }
    }

    result = z.object(fields);
    putCache(model, 'where', result);

    return result;
}

export function makeSelectSchema(
    schema: SchemaDef,
    model: string
): ZodObject<any> {
    let result = getCache(model, 'select') as ZodObject<any> | undefined;
    if (result) {
        return result;
    }

    const modelDef = requireModel(schema, model);
    const fields: Record<string, any> = {};
    for (const field of Object.keys(modelDef.fields)) {
        const fieldDef = requireField(schema, model, field);
        if (fieldDef.relation) {
            fields[field] = z
                .union([
                    z.boolean(),
                    z.object({
                        select: z
                            .lazy(() => makeSelectSchema(schema, fieldDef.type))
                            .optional(),
                        include: z
                            .lazy(() =>
                                makeIncludeSchema(schema, fieldDef.type)
                            )
                            .optional(),
                    }),
                ])
                .optional();
        } else {
            fields[field] = z.boolean().optional();
        }
    }

    result = z.object(fields);
    putCache(model, 'select', result);
    return result;
}

export function makeIncludeSchema(
    schema: SchemaDef,
    model: string
): ZodObject<any> {
    let result = getCache(model, 'include') as ZodObject<any> | undefined;
    if (result) {
        return result;
    }

    const modelDef = requireModel(schema, model);
    const fields: Record<string, any> = {};
    for (const field of Object.keys(modelDef.fields)) {
        const fieldDef = requireField(schema, model, field);
        if (fieldDef.relation) {
            fields[field] = z
                .union([
                    z.boolean(),
                    z.object({
                        select: z
                            .lazy(() => makeSelectSchema(schema, fieldDef.type))
                            .optional(),
                        include: z
                            .lazy(() =>
                                makeIncludeSchema(schema, fieldDef.type)
                            )
                            .optional(),
                    }),
                ])
                .optional();
        }
    }

    result = z.object(fields);
    putCache(model, 'include', result);
    return result;
}

function makePrimitiveSchema(type: string) {
    return Match.value(type).pipe(
        Match.when('String', () => z.string()),
        Match.when('Int', () => z.number()),
        Match.when('Float', () => z.number()),
        Match.when('Boolean', () => z.boolean()),
        Match.when('BigInt', () => z.string()),
        Match.when('Decimal', () => z.string()),
        Match.when('DateTime', () => z.string()),
        Match.orElse(() => z.unknown())
    );
}

//#endregion
