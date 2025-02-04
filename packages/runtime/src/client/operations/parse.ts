import { Match } from 'effect';
import { z, ZodSchema } from 'zod';
import type { SchemaDef } from '../../schema/schema';
import { InternalError } from '../errors';
import { getUniqueFields, requireField, requireModel } from '../query-utils';

const schemas = new Map<string, ZodSchema>();

type SchemaKinds =
    | 'where'
    | 'whereUnique'
    | 'select'
    | 'include'
    | 'find'
    | 'findUnique';

function getCache(model: string, kind: SchemaKinds) {
    return schemas.get(`${model}:${kind}`);
}

function putCache(model: string, kind: SchemaKinds, schema: ZodSchema) {
    schemas.set(`${model}:${kind}`, schema);
}

export function makeWhereSchema(
    schema: SchemaDef,
    model: string,
    unique: boolean
): ZodSchema {
    const cacheKey = unique ? 'whereUnique' : 'where';
    let result = getCache(model, cacheKey);
    if (result) {
        return result;
    }

    const modelDef = requireModel(schema, model);
    const fields: Record<string, any> = {};
    for (const field of Object.keys(modelDef.fields)) {
        const fieldDef = requireField(schema, model, field);
        if (fieldDef.relation) {
            fields[field] = z.lazy(() =>
                makeWhereSchema(schema, fieldDef.type, false).optional()
            );
        } else {
            fields[field] = makePrimitiveSchema(fieldDef.type).optional();
        }
    }

    const baseWhere = z.object(fields);
    result = baseWhere;

    if (unique) {
        // requires at least one unique field (field set) is required
        const uniqueFields = getUniqueFields(schema, model);
        if (uniqueFields.length === 0) {
            throw new InternalError(`Model "${model}" has no unique fields`);
        }

        if (uniqueFields.length === 1) {
            // only one unique field (set), mark the field(s) required
            result = baseWhere.required(
                uniqueFields[0]!.reduce(
                    (acc, k) => ({
                        ...acc,
                        [k.name]: true,
                    }),
                    {}
                )
            );
        } else {
            result = baseWhere.refine((value) => {
                // check that at least one unique field is set
                return uniqueFields.some((fields) =>
                    fields.every(({ name }) => value[name] !== undefined)
                );
            }, `At least one unique field or field set must be set`);
        }
    }

    putCache(model, cacheKey, result);

    return result;
}

export function makeSelectSchema(schema: SchemaDef, model: string) {
    let result = getCache(model, 'select');
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

export function makeIncludeSchema(schema: SchemaDef, model: string) {
    let result = getCache(model, 'include');
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

export function makeFindSchema(
    schema: SchemaDef,
    model: string,
    unique: boolean
) {
    const cacheKey = unique ? 'findUnique' : 'find';
    let result = getCache(model, cacheKey);
    if (result) {
        return result;
    }

    const where = makeWhereSchema(schema, model, unique);
    const select = makeSelectSchema(schema, model);
    const include = makeIncludeSchema(schema, model);
    result = z
        .object({
            where: unique ? where : where.optional(),
            select: select.optional(),
            include: include.optional(),
            skip: z.number().int().nonnegative().optional(),
            take: z.number().int().nonnegative().optional(),
        })
        .refine(
            (value) => !value.select || !value.include,
            '"select" and "include" cannot be used together'
        );

    if (!unique) {
        result = result.optional();
    }

    putCache(model, cacheKey, result);
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
