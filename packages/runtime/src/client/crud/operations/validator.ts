import { match, P } from 'ts-pattern';
import { z, ZodSchema } from 'zod';
import type { GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldDef } from '../../../schema/schema';
import { InternalError, QueryError } from '../../errors';
import {
    fieldHasDefaultValue,
    getEnum,
    getModel,
    getUniqueFields,
    requireField,
    requireModel,
} from '../../query-utils';
import type { CreateArgs, FindArgs } from '../../types';

export class InputValidator<Schema extends SchemaDef> {
    constructor(private readonly schema: Schema) {}

    validateFindArgs(model: string, unique: boolean, args: unknown) {
        const schema = this.makeFindSchema(model, unique, true);
        const { error } = schema.safeParse(args);
        if (error) {
            throw new QueryError(`Invalid find args: ${error.message}`);
        }
        return args as FindArgs<Schema, GetModels<Schema>, true>;
    }

    validateCreateArgs(model: string, args: unknown) {
        const schema = this.makeCreateSchema(model);
        const { error } = schema.safeParse(args);
        if (error) {
            throw new QueryError(`Invalid create args: ${error}`);
        }
        return args as CreateArgs<Schema, GetModels<Schema>>;
    }

    // #region find
    private makeFindSchema(
        model: string,
        unique: boolean,
        collection: boolean
    ) {
        const fields: Record<string, z.ZodSchema> = {};
        const where = this.makeWhereSchema(model, unique);
        if (unique) {
            fields['where'] = where;
        } else {
            fields['where'] = where.optional();
        }

        fields['select'] = this.makeSelectSchema(model).optional();
        fields['include'] = this.makeIncludeSchema(model).optional();

        if (collection) {
            fields['skip'] = z.number().int().nonnegative().optional();
            fields['take'] = z.number().int().nonnegative().optional();
            fields['orderBy'] = this.orArray(
                this.makeOrderBySchema(model),
                true
            ).optional();
        }

        let result: ZodSchema = z
            .object(fields)
            .strict()
            .refine(
                (value) => !value['select'] || !value['include'],
                '"select" and "include" cannot be used together'
            );

        if (!unique) {
            result = result.optional();
        }
        return result;
    }

    private makePrimitiveSchema(type: string) {
        return match(type)
            .with('String', () => z.string())
            .with('Int', () => z.number())
            .with('Float', () => z.number())
            .with('Boolean', () => z.boolean())
            .with('BigInt', () => z.string())
            .with('Decimal', () => z.string())
            .with('DateTime', () => z.string())
            .otherwise(() => z.unknown());
    }

    protected makeWhereSchema(model: string, unique: boolean): ZodSchema {
        const modelDef = getModel(this.schema, model);
        if (!modelDef) {
            throw new QueryError(`Model "${model}" not found`);
        }

        const fields: Record<string, any> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            let fieldSchema: ZodSchema | undefined;

            if (fieldDef.relation) {
                fieldSchema = z.lazy(() =>
                    this.makeWhereSchema(fieldDef.type, false).optional()
                );

                // optional to-one relation allows null
                fieldSchema = this.nullableIf(
                    fieldSchema,
                    !fieldDef.array && !!fieldDef.optional
                );

                if (fieldDef.array) {
                    // to-many relation
                    fieldSchema = z.union([
                        fieldSchema,
                        z.object({
                            some: fieldSchema.optional(),
                            every: fieldSchema.optional(),
                            none: fieldSchema.optional(),
                        }),
                    ]);
                } else {
                    // to-one relation
                    fieldSchema = z.union([
                        fieldSchema,
                        z.object({
                            is: fieldSchema.optional(),
                            isNot: fieldSchema.optional(),
                        }),
                    ]);
                }
            } else {
                const enumDef = getEnum(this.schema, fieldDef.type);
                if (enumDef) {
                    // enum
                    if (Object.keys(enumDef).length > 0) {
                        fieldSchema = this.nullableIf(
                            z.enum(
                                Object.keys(enumDef) as [string, ...string[]]
                            ),
                            !!fieldDef.optional
                        );
                    }
                } else {
                    // primitive field
                    fieldSchema = this.makePrimitiveFilterSchema(
                        fieldDef.type as BuiltinType,
                        !!fieldDef.optional
                    );
                }
            }

            if (fieldSchema) {
                fields[field] = fieldSchema.optional();
            }
        }

        // expression builder
        fields['$expr'] = z.function().optional();

        // logical operators
        fields['AND'] = this.orArray(
            z.lazy(() => this.makeWhereSchema(model, false)),
            true
        ).optional();
        fields['OR'] = z
            .lazy(() => this.makeWhereSchema(model, false))
            .array()
            .optional();
        fields['NOT'] = this.orArray(
            z.lazy(() => this.makeWhereSchema(model, false)),
            true
        ).optional();

        const baseWhere = z.object(fields).strict();
        let result: ZodSchema = baseWhere;

        if (unique) {
            // requires at least one unique field (field set) is required
            const uniqueFields = getUniqueFields(this.schema, model);
            if (uniqueFields.length === 0) {
                throw new InternalError(
                    `Model "${model}" has no unique fields`
                );
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

        return result;
    }

    protected makePrimitiveFilterSchema(type: BuiltinType, optional: boolean) {
        return match(type)
            .with('String', () => this.makeStringFilterSchema(optional))
            .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), () =>
                this.makeNumberFilterSchema(optional)
            )
            .with('Boolean', () => this.makeBooleanFilterSchema(optional))
            .with('DateTime', () => this.makeDateTimeFilterSchema(optional))
            .exhaustive();
    }

    private makeDateTimeFilterSchema(optional: boolean): ZodSchema {
        return this.makeCommonPrimitiveFilterSchema(
            z.union([z.string().date(), z.date()]),
            optional,
            () => z.lazy(() => this.makeDateTimeFilterSchema(optional))
        );
    }

    private makeBooleanFilterSchema(optional: boolean): ZodSchema {
        return z.union([
            this.nullableIf(z.boolean(), optional),
            z.object({
                equals: this.nullableIf(z.boolean(), optional).optional(),
                not: z
                    .lazy(() => this.makeBooleanFilterSchema(optional))
                    .optional(),
            }),
        ]);
    }

    private makeCommonPrimitiveFilterComponents(
        baseSchema: ZodSchema,
        optional: boolean,
        makeThis: () => ZodSchema
    ) {
        return {
            equals: this.nullableIf(baseSchema.optional(), optional),
            notEquals: this.nullableIf(baseSchema.optional(), optional),
            in: baseSchema.array().optional(),
            notIn: baseSchema.array().optional(),
            lt: baseSchema.optional(),
            lte: baseSchema.optional(),
            gt: baseSchema.optional(),
            gte: baseSchema.optional(),
            not: makeThis().optional(),
        };
    }

    private makeCommonPrimitiveFilterSchema(
        baseSchema: ZodSchema,
        optional: boolean,
        makeThis: () => ZodSchema
    ) {
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.object(
                this.makeCommonPrimitiveFilterComponents(
                    baseSchema,
                    optional,
                    makeThis
                )
            ),
        ]);
    }

    private makeNumberFilterSchema(optional: boolean): ZodSchema {
        const base = z.union([z.number(), z.bigint()]);
        return this.makeCommonPrimitiveFilterSchema(base, optional, () =>
            z.lazy(() => this.makeNumberFilterSchema(optional))
        );
    }

    private makeStringFilterSchema(optional: boolean): ZodSchema {
        return this.makeCommonPrimitiveFilterSchema(z.string(), optional, () =>
            z.lazy(() => this.makeStringFilterSchema(optional))
        );
    }

    protected makeSelectSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.boolean(),
                        z.object({
                            select: z
                                .lazy(() =>
                                    this.makeSelectSchema(fieldDef.type)
                                )
                                .optional(),
                            include: z
                                .lazy(() =>
                                    this.makeIncludeSchema(fieldDef.type)
                                )
                                .optional(),
                        }),
                    ])
                    .optional();
            } else {
                fields[field] = z.boolean().optional();
            }
        }

        return z.object(fields);
    }

    protected makeIncludeSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.boolean(),
                        z.object({
                            select: z
                                .lazy(() =>
                                    this.makeSelectSchema(fieldDef.type)
                                )
                                .optional(),
                            include: z
                                .lazy(() =>
                                    this.makeIncludeSchema(fieldDef.type)
                                )
                                .optional(),
                            where: z
                                .lazy(() =>
                                    this.makeWhereSchema(fieldDef.type, false)
                                )
                                .optional(),
                        }),
                    ])
                    .optional();
            }
        }

        return z.object(fields);
    }

    protected makeOrderBySchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                // TODO
            } else {
                if (fieldDef.optional) {
                    fields[field] = z
                        .object({
                            sort: z.union([
                                z.literal('asc'),
                                z.literal('desc'),
                            ]),
                            nulls: z.union([
                                z.literal('first'),
                                z.literal('last'),
                            ]),
                        })
                        .optional();
                } else {
                    fields[field] = z
                        .union([z.literal('asc'), z.literal('desc')])
                        .optional();
                }
            }
        }

        return z.object(fields);
    }
    // #endregion

    // #region create
    private makeCreateSchema(model: string) {
        const dataSchema = this.makeCreateDataSchema(model, false);
        return z
            .object({
                data: dataSchema,
                select: z.record(z.string(), z.any()).optional(),
                include: z.record(z.string(), z.any()).optional(),
            })
            .strict();
    }

    private makeCreateDataSchema(
        model: string,
        canBeArray: boolean,
        withoutFields: string[] = [],
        withoutRelationFields = false
    ) {
        const regularAndFkFields: any = {};
        const regularAndRelationFields: any = {};
        const modelDef = requireModel(this.schema, model);
        const hasRelation = Object.values(modelDef.fields).some(
            (f) => f.relation
        );

        Object.keys(modelDef.fields).forEach((field) => {
            if (withoutFields.includes(field)) {
                return;
            }
            const fieldDef = requireField(this.schema, model, field);

            if (fieldDef.relation) {
                if (withoutRelationFields) {
                    return;
                }
                const excludeFields: string[] = [];
                const oppositeField = fieldDef.relation.opposite;
                if (oppositeField) {
                    excludeFields.push(oppositeField);
                    const oppositeFieldDef = requireField(
                        this.schema,
                        fieldDef.type,
                        oppositeField
                    );
                    if (oppositeFieldDef.relation?.fields) {
                        excludeFields.push(...oppositeFieldDef.relation.fields);
                    }
                }

                let fieldSchema: ZodSchema = z.lazy(() =>
                    this.makeRelationSchema(fieldDef, excludeFields)
                );

                // optional or array relations are optional
                if (fieldDef.optional || fieldDef.array) {
                    fieldSchema = fieldSchema.optional();
                }

                // optional to-one relation can be null
                if (fieldDef.optional && !fieldDef.array) {
                    fieldSchema = fieldSchema.nullable();
                }
                regularAndRelationFields[field] = fieldSchema;
            } else {
                let fieldSchema: ZodSchema = this.makePrimitiveSchema(
                    fieldDef.type
                );
                if (fieldDef.optional || fieldHasDefaultValue(fieldDef)) {
                    fieldSchema = fieldSchema.optional();
                }

                if (fieldDef.optional) {
                    fieldSchema = fieldSchema.nullable();
                }

                regularAndFkFields[field] = fieldSchema;
                if (!fieldDef.foreignKeyFor) {
                    regularAndRelationFields[field] = fieldSchema;
                }
            }
        });

        if (!hasRelation) {
            return this.orArray(
                z.object(regularAndFkFields).strict(),
                canBeArray
            );
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

    private makeRelationSchema(fieldDef: FieldDef, withoutFields: string[]) {
        return z
            .object({
                create: this.makeCreateDataSchema(
                    fieldDef.type,
                    !!fieldDef.array,
                    withoutFields
                ).optional(),

                connect: this.makeConnectDataSchema(
                    fieldDef.type,
                    !!fieldDef.array
                ).optional(),

                connectOrCreate: this.makeConnectOrCreateDataSchema(
                    fieldDef.type,
                    !!fieldDef.array,
                    withoutFields
                ).optional(),

                createMany: this.makeCreateManyDataSchema(
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

    private makeConnectDataSchema(model: string, canBeArray: boolean) {
        return this.orArray(this.makeWhereSchema(model, true), canBeArray);
    }

    private makeConnectOrCreateDataSchema(
        model: string,
        canBeArray: boolean,
        withoutFields: string[]
    ) {
        const whereSchema = this.makeWhereSchema(model, true);
        const createSchema = this.makeCreateDataSchema(
            model,
            false,
            withoutFields
        );
        return this.orArray(
            z
                .object({
                    where: whereSchema,
                    create: createSchema,
                })
                .strict(),
            canBeArray
        );
    }

    private makeCreateManyDataSchema(
        fieldDef: FieldDef,
        withoutFields: string[]
    ) {
        return z
            .object({
                data: this.makeCreateDataSchema(
                    fieldDef.type,
                    false,
                    withoutFields,
                    true
                ),
                skipDuplicates: z.boolean().optional(),
            })
            .strict();
    }
    // #endregion

    // #region helpers
    private nullableIf(schema: ZodSchema, nullable: boolean) {
        return nullable ? schema.nullable() : schema;
    }

    private orArray(schema: ZodSchema, canBeArray: boolean) {
        return canBeArray ? z.union([schema, z.array(schema)]) : schema;
    }
    // #endregion
}
