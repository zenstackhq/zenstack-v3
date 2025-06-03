import Decimal from 'decimal.js';
import { match, P } from 'ts-pattern';
import { z, ZodSchema } from 'zod';
import type {
    BuiltinType,
    EnumDef,
    FieldDef,
    GetModels,
    SchemaDef,
} from '../../schema/schema';
import { NUMERIC_FIELD_TYPES } from '../constants';
import {
    type AggregateArgs,
    type CountArgs,
    type CreateArgs,
    type CreateManyAndReturnArgs,
    type CreateManyArgs,
    type DeleteArgs,
    type DeleteManyArgs,
    type FindArgs,
    type GroupByArgs,
    type UpdateArgs,
    type UpdateManyArgs,
    type UpsertArgs,
} from '../crud-types';
import { InternalError, QueryError } from '../errors';
import {
    fieldHasDefaultValue,
    getEnum,
    getModel,
    getUniqueFields,
    requireField,
    requireModel,
} from '../query-utils';

export class InputValidator<Schema extends SchemaDef> {
    constructor(private readonly schema: Schema) {}

    validateFindArgs(model: GetModels<Schema>, unique: boolean, args: unknown) {
        return this.validate<FindArgs<Schema, GetModels<Schema>, true>>(
            this.makeFindSchema(model, unique, true),
            'find',
            args
        );
    }

    validateCreateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CreateArgs<Schema, GetModels<Schema>>>(
            this.makeCreateSchema(model),
            'create',
            args
        );
    }

    validateCreateManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<
            CreateManyArgs<Schema, GetModels<Schema>> | undefined
        >(this.makeCreateManySchema(model), 'createMany', args);
    }

    validateCreateManyAndReturnArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<
            CreateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined
        >(
            this.makeCreateManyAndReturnSchema(model),
            'createManyAndReturn',
            args
        );
    }

    validateUpdateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpdateArgs<Schema, GetModels<Schema>>>(
            this.makeUpdateSchema(model),
            'update',
            args
        );
    }

    validateUpdateManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpdateManyArgs<Schema, GetModels<Schema>>>(
            this.makeUpdateManySchema(model),
            'updateMany',
            args
        );
    }

    validateUpsertArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpsertArgs<Schema, GetModels<Schema>>>(
            this.makeUpsertSchema(model),
            'upsert',
            args
        );
    }

    validateDeleteArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<DeleteArgs<Schema, GetModels<Schema>>>(
            this.makeDeleteSchema(model),
            'delete',
            args
        );
    }

    validateDeleteManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<
            DeleteManyArgs<Schema, GetModels<Schema>> | undefined
        >(this.makeDeleteManySchema(model), 'deleteMany', args);
    }

    validateCountArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CountArgs<Schema, GetModels<Schema>> | undefined>(
            this.makeCountSchema(model),
            'count',
            args
        );
    }

    validateAggregateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<AggregateArgs<Schema, GetModels<Schema>>>(
            this.makeAggregateSchema(model),
            'aggregate',
            args
        );
    }

    validateGroupByArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<GroupByArgs<Schema, GetModels<Schema>>>(
            this.makeGroupBySchema(model),
            'groupBy',
            args
        );
    }

    private validate<T>(schema: ZodSchema, operation: string, args: unknown) {
        const { error } = schema.safeParse(args);
        if (error) {
            throw new QueryError(`Invalid ${operation} args: ${error.message}`);
        }
        return args as T;
    }

    // #region Find

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
        fields['omit'] = this.makeOmitSchema(model).optional();
        fields['distinct'] = this.makeDistinctSchema(model).optional();
        fields['cursor'] = this.makeCursorSchema(model).optional();

        if (collection) {
            fields['skip'] = z.number().int().nonnegative().optional();
            fields['take'] = z.number().int().optional();
            fields['orderBy'] = this.orArray(
                this.makeOrderBySchema(model, true, false),
                true
            ).optional();
        }

        let result: ZodSchema = z.object(fields).strict();
        result = this.refineForSelectIncludeMutuallyExclusive(result);
        result = this.refineForSelectOmitMutuallyExclusive(result);

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
            .with('BigInt', () => z.union([z.number(), z.bigint()]))
            .with('Decimal', () =>
                z.union([z.number(), z.instanceof(Decimal), z.string()])
            )
            .with('DateTime', () => z.union([z.date(), z.string().datetime()]))
            .with('Bytes', () => z.instanceof(Uint8Array))
            .otherwise(() => z.unknown());
    }

    private makeWhereSchema(
        model: string,
        unique: boolean,
        withoutRelationFields = false
    ): ZodSchema {
        const modelDef = getModel(this.schema, model);
        if (!modelDef) {
            throw new QueryError(`Model "${model}" not found`);
        }

        const fields: Record<string, any> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            let fieldSchema: ZodSchema | undefined;

            if (fieldDef.relation) {
                if (withoutRelationFields) {
                    continue;
                }
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
                        fieldSchema = this.makeEnumFilterSchema(
                            enumDef,
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
            z.lazy(() =>
                this.makeWhereSchema(model, false, withoutRelationFields)
            ),
            true
        ).optional();
        fields['OR'] = z
            .lazy(() =>
                this.makeWhereSchema(model, false, withoutRelationFields)
            )
            .array()
            .optional();
        fields['NOT'] = this.orArray(
            z.lazy(() =>
                this.makeWhereSchema(model, false, withoutRelationFields)
            ),
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

    private makeEnumFilterSchema(enumDef: EnumDef, optional: boolean) {
        const baseSchema = z.enum(
            Object.keys(enumDef) as [string, ...string[]]
        );
        const components = this.makeCommonPrimitiveFilterComponents(
            baseSchema,
            optional,
            () => z.lazy(() => this.makeEnumFilterSchema(enumDef, optional))
        );
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.object({
                equals: components.equals,
                in: components.in,
                notIn: components.notIn,
                not: components.not,
            }),
        ]);
    }

    private makePrimitiveFilterSchema(type: BuiltinType, optional: boolean) {
        return match(type)
            .with('String', () => this.makeStringFilterSchema(optional))
            .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                this.makeNumberFilterSchema(
                    this.makePrimitiveSchema(type),
                    optional
                )
            )
            .with('Boolean', () => this.makeBooleanFilterSchema(optional))
            .with('DateTime', () => this.makeDateTimeFilterSchema(optional))
            .with('Bytes', () => this.makeBytesFilterSchema(optional))
            .exhaustive();
    }

    private makeDateTimeFilterSchema(optional: boolean): ZodSchema {
        return this.makeCommonPrimitiveFilterSchema(
            z.union([z.string().datetime(), z.date()]),
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

    private makeBytesFilterSchema(optional: boolean): ZodSchema {
        const baseSchema = z.instanceof(Uint8Array);
        const components = this.makeCommonPrimitiveFilterComponents(
            baseSchema,
            optional,
            () => z.instanceof(Uint8Array)
        );
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.object({
                equals: components.equals,
                in: components.in,
                notIn: components.notIn,
                not: components.not,
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

    private makeNumberFilterSchema(
        baseSchema: ZodSchema,
        optional: boolean
    ): ZodSchema {
        return this.makeCommonPrimitiveFilterSchema(baseSchema, optional, () =>
            z.lazy(() => this.makeNumberFilterSchema(baseSchema, optional))
        );
    }

    private makeStringFilterSchema(optional: boolean): ZodSchema {
        return this.makeCommonPrimitiveFilterSchema(z.string(), optional, () =>
            z.lazy(() => this.makeStringFilterSchema(optional))
        );
    }

    private makeSelectSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.literal(true),
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

        const toManyRelations = Object.entries(modelDef.fields).filter(
            ([, value]) => value.relation && value.array
        );

        if (toManyRelations.length > 0) {
            fields['_count'] = z
                .union([
                    z.literal(true),
                    z.object(
                        toManyRelations.reduce(
                            (acc, [name, fieldDef]) => ({
                                ...acc,
                                [name]: z
                                    .union([
                                        z.boolean(),
                                        z.object({
                                            where: this.makeWhereSchema(
                                                fieldDef.type,
                                                false,
                                                false
                                            ),
                                        }),
                                    ])
                                    .optional(),
                            }),
                            {} as Record<string, ZodSchema>
                        )
                    ),
                ])
                .optional();
        }

        return z.object(fields).strict();
    }

    private makeOmitSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (!fieldDef.relation) {
                fields[field] = z.boolean().optional();
            }
        }
        return z.object(fields).strict();
    }

    private makeIncludeSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.literal(true),
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

        return z.object(fields).strict();
    }

    private makeOrderBySchema(
        model: string,
        withRelation: boolean,
        WithAggregation: boolean
    ) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodSchema> = {};
        const sort = z.union([z.literal('asc'), z.literal('desc')]);
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                // relations
                if (withRelation) {
                    fields[field] = z.lazy(() =>
                        this.makeOrderBySchema(
                            fieldDef.type,
                            withRelation,
                            WithAggregation
                        ).optional()
                    );
                }
            } else {
                // scalars
                if (fieldDef.optional) {
                    fields[field] = z
                        .union([
                            sort,
                            z.object({
                                sort,
                                nulls: z.union([
                                    z.literal('first'),
                                    z.literal('last'),
                                ]),
                            }),
                        ])
                        .optional();
                } else {
                    fields[field] = sort.optional();
                }
            }
        }

        // aggregations
        if (WithAggregation) {
            const aggregationFields = [
                '_count',
                '_avg',
                '_sum',
                '_min',
                '_max',
            ];
            for (const agg of aggregationFields) {
                fields[agg] = z.lazy(() =>
                    this.makeOrderBySchema(model, true, false).optional()
                );
            }
        }

        return z.object(fields);
    }

    private makeDistinctSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const nonRelationFields = Object.keys(modelDef.fields).filter(
            (field) => !modelDef.fields[field]?.relation
        );
        return this.orArray(z.enum(nonRelationFields as any), true);
    }

    private makeCursorSchema(model: string) {
        return this.makeWhereSchema(model, true, true).optional();
    }

    // #endregion

    // #region Create

    private makeCreateSchema(model: string) {
        const dataSchema = this.makeCreateDataSchema(model, false);
        const schema = z
            .object({
                data: dataSchema,
                select: this.makeSelectSchema(model).optional(),
                include: this.makeIncludeSchema(model).optional(),
                omit: this.makeOmitSchema(model).optional(),
            })
            .strict();
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeCreateManySchema(model: string) {
        return this.makeCreateManyDataSchema(model, []).optional();
    }

    private makeCreateManyAndReturnSchema(model: string) {
        const base = this.makeCreateManyDataSchema(model, []);
        return base
            .merge(
                z.object({
                    select: this.makeSelectSchema(model).optional(),
                    include: this.makeIncludeSchema(model).optional(),
                    omit: this.makeOmitSchema(model).optional(),
                })
            )
            .optional();
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
        const hasRelation =
            !withoutRelationFields &&
            Object.entries(modelDef.fields).some(
                ([f, def]) => !withoutFields.includes(f) && def.relation
            );

        Object.keys(modelDef.fields).forEach((field) => {
            if (withoutFields.includes(field)) {
                return;
            }
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.computed) {
                return;
            }

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
                    this.makeRelationManipulationSchema(
                        fieldDef,
                        excludeFields,
                        'create'
                    )
                );

                if (fieldDef.optional || fieldDef.array) {
                    // optional or array relations are optional
                    fieldSchema = fieldSchema.optional();
                } else {
                    // if all fk fields are optional, the relation is optional
                    let allFksOptional = false;
                    if (fieldDef.relation.fields) {
                        allFksOptional = fieldDef.relation.fields.every((f) => {
                            const fkDef = requireField(this.schema, model, f);
                            return (
                                fkDef.optional || fieldHasDefaultValue(fkDef)
                            );
                        });
                    }
                    if (allFksOptional) {
                        fieldSchema = fieldSchema.optional();
                    }
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

                if (fieldDef.array) {
                    fieldSchema = z.array(fieldSchema).optional();
                }

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

    private makeRelationManipulationSchema(
        fieldDef: FieldDef,
        withoutFields: string[],
        mode: 'create' | 'update'
    ) {
        const fieldType = fieldDef.type;
        const array = !!fieldDef.array;
        let fields: Record<string, ZodSchema> = {
            create: this.makeCreateDataSchema(
                fieldDef.type,
                !!fieldDef.array,
                withoutFields
            ).optional(),

            connect: this.makeConnectDataSchema(fieldType, array).optional(),

            connectOrCreate: this.makeConnectOrCreateDataSchema(
                fieldType,
                array,
                withoutFields
            ).optional(),

            disconnect: this.makeDisconnectDataSchema(
                fieldType,
                array
            ).optional(),

            delete: this.makeDeleteRelationDataSchema(
                fieldType,
                array,
                true
            ).optional(),
        };

        if (array) {
            fields['createMany'] = this.makeCreateManyDataSchema(
                fieldType,
                withoutFields
            ).optional();
        }

        if (mode === 'update') {
            fields['update'] = array
                ? this.orArray(
                      z.object({
                          where: this.makeWhereSchema(fieldType, true),
                          data: this.makeUpdateDataSchema(
                              fieldType,
                              withoutFields
                          ),
                      }),
                      true
                  ).optional()
                : z
                      .union([
                          z.object({
                              where: this.makeWhereSchema(fieldType, true),
                              data: this.makeUpdateDataSchema(
                                  fieldType,
                                  withoutFields
                              ),
                          }),
                          this.makeUpdateDataSchema(fieldType, withoutFields),
                      ])
                      .optional();

            fields['upsert'] = this.orArray(
                z.object({
                    where: this.makeWhereSchema(fieldType, true),
                    create: this.makeCreateDataSchema(
                        fieldType,
                        false,
                        withoutFields
                    ),
                    update: this.makeUpdateDataSchema(fieldType, withoutFields),
                }),
                true
            ).optional();

            if (array) {
                fields['set'] = this.makeSetDataSchema(
                    fieldType,
                    true
                ).optional();

                fields['updateMany'] = this.orArray(
                    z.object({
                        where: this.makeWhereSchema(fieldType, false, true),
                        data: this.makeUpdateDataSchema(
                            fieldType,
                            withoutFields
                        ),
                    }),
                    true
                ).optional();

                fields['deleteMany'] = this.makeDeleteRelationDataSchema(
                    fieldType,
                    true,
                    false
                ).optional();
            }
        }

        return z
            .object(fields)
            .strict()
            .refine(
                (v) => Object.keys(v).length > 0,
                'At least one action is required'
            );
    }

    private makeSetDataSchema(model: string, canBeArray: boolean) {
        return this.orArray(this.makeWhereSchema(model, true), canBeArray);
    }

    private makeConnectDataSchema(model: string, canBeArray: boolean) {
        return this.orArray(this.makeWhereSchema(model, true), canBeArray);
    }

    private makeDisconnectDataSchema(model: string, canBeArray: boolean) {
        if (canBeArray) {
            return this.orArray(this.makeWhereSchema(model, true), canBeArray);
        } else {
            return z.union([z.boolean(), this.makeWhereSchema(model, true)]);
        }
    }

    private makeDeleteRelationDataSchema(
        model: string,
        toManyRelation: boolean,
        uniqueFilter: boolean
    ) {
        return toManyRelation
            ? this.orArray(this.makeWhereSchema(model, uniqueFilter), true)
            : z.union([z.boolean(), this.makeWhereSchema(model, uniqueFilter)]);
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

    private makeCreateManyDataSchema(model: string, withoutFields: string[]) {
        return z
            .object({
                data: this.makeCreateDataSchema(
                    model,
                    true,
                    withoutFields,
                    true
                ),
                skipDuplicates: z.boolean().optional(),
            })
            .strict();
    }

    // #endregion

    // #region Update

    private makeUpdateSchema(model: string) {
        const schema = z
            .object({
                where: this.makeWhereSchema(model, true),
                data: this.makeUpdateDataSchema(model),
                select: this.makeSelectSchema(model).optional(),
                include: this.makeIncludeSchema(model).optional(),
                omit: this.makeOmitSchema(model).optional(),
            })
            .strict();

        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeUpdateManySchema(model: string) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                data: this.makeUpdateDataSchema(model, [], true),
                limit: z.number().int().nonnegative().optional(),
            })
            .strict();
    }

    private makeUpsertSchema(model: string) {
        const schema = z
            .object({
                where: this.makeWhereSchema(model, true),
                create: this.makeCreateDataSchema(model, false),
                update: this.makeUpdateDataSchema(model),
                select: this.makeSelectSchema(model).optional(),
                include: this.makeIncludeSchema(model).optional(),
                omit: this.makeOmitSchema(model).optional(),
            })
            .strict();

        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeUpdateDataSchema(
        model: string,
        withoutFields: string[] = [],
        withoutRelationFields = false
    ) {
        const regularAndFkFields: any = {};
        const regularAndRelationFields: any = {};
        const modelDef = requireModel(this.schema, model);
        const hasRelation = Object.entries(modelDef.fields).some(
            ([key, value]) => value.relation && !withoutFields.includes(key)
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
                let fieldSchema: ZodSchema = z
                    .lazy(() =>
                        this.makeRelationManipulationSchema(
                            fieldDef,
                            excludeFields,
                            'update'
                        )
                    )
                    .optional();
                // optional to-one relation can be null
                if (fieldDef.optional && !fieldDef.array) {
                    fieldSchema = fieldSchema.nullable();
                }
                regularAndRelationFields[field] = fieldSchema;
            } else {
                let fieldSchema: ZodSchema = this.makePrimitiveSchema(
                    fieldDef.type
                ).optional();

                if (this.isNumericField(fieldDef)) {
                    fieldSchema = z.union([
                        fieldSchema,
                        z
                            .object({
                                set: this.nullableIf(
                                    z.number().optional(),
                                    !!fieldDef.optional
                                ),
                                increment: z.number().optional(),
                                decrement: z.number().optional(),
                                multiply: z.number().optional(),
                                divide: z.number().optional(),
                            })
                            .refine(
                                (v) => Object.keys(v).length <= 1,
                                'Only one of "set", "increment", "decrement", "multiply", or "divide" can be provided'
                            ),
                    ]);
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
            return z.object(regularAndFkFields).strict();
        } else {
            return z.union([
                z.object(regularAndFkFields).strict(),
                z.object(regularAndRelationFields).strict(),
            ]);
        }
    }

    // #endregion

    // #region Delete

    private makeDeleteSchema(model: GetModels<Schema>) {
        const schema = z
            .object({
                where: this.makeWhereSchema(model, true),
                select: this.makeSelectSchema(model).optional(),
                include: this.makeIncludeSchema(model).optional(),
            })
            .strict();
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeDeleteManySchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                limit: z.number().int().nonnegative().optional(),
            })
            .strict()
            .optional();
    }

    // #endregion

    // #region Count

    makeCountSchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                skip: z.number().int().nonnegative().optional(),
                take: z.number().int().optional(),
                orderBy: this.orArray(
                    this.makeOrderBySchema(model, true, false),
                    true
                ).optional(),
                select: this.makeCountAggregateInputSchema(model).optional(),
            })
            .strict()
            .optional();
    }

    private makeCountAggregateInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.union([
            z.literal(true),
            z
                .object({
                    _all: z.literal(true).optional(),
                    ...Object.keys(modelDef.fields).reduce((acc, field) => {
                        acc[field] = z.literal(true).optional();
                        return acc;
                    }, {} as Record<string, ZodSchema>),
                })
                .strict(),
        ]);
    }

    // #endregion

    // #region Aggregate

    makeAggregateSchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                skip: z.number().int().nonnegative().optional(),
                take: z.number().int().optional(),
                orderBy: this.orArray(
                    this.makeOrderBySchema(model, true, false),
                    true
                ).optional(),
                _count: this.makeCountAggregateInputSchema(model).optional(),
                _avg: this.makeSumAvgInputSchema(model).optional(),
                _sum: this.makeSumAvgInputSchema(model).optional(),
                _min: this.makeMinMaxInputSchema(model).optional(),
                _max: this.makeMinMaxInputSchema(model).optional(),
            })
            .strict()
            .optional();
    }

    makeSumAvgInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.object(
            Object.keys(modelDef.fields).reduce((acc, field) => {
                const fieldDef = requireField(this.schema, model, field);
                if (this.isNumericField(fieldDef)) {
                    acc[field] = z.literal(true).optional();
                }
                return acc;
            }, {} as Record<string, ZodSchema>)
        );
    }

    makeMinMaxInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.object(
            Object.keys(modelDef.fields).reduce((acc, field) => {
                const fieldDef = requireField(this.schema, model, field);
                if (!fieldDef.relation && !fieldDef.array) {
                    acc[field] = z.literal(true).optional();
                }
                return acc;
            }, {} as Record<string, ZodSchema>)
        );
    }

    private makeGroupBySchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        const nonRelationFields = Object.keys(modelDef.fields).filter(
            (field) => !modelDef.fields[field]?.relation
        );

        let schema: ZodSchema = z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                orderBy: this.orArray(
                    this.makeOrderBySchema(model, false, true),
                    true
                ).optional(),
                by: this.orArray(z.enum(nonRelationFields as any), true),
                having: this.makeWhereSchema(model, false, true).optional(),
                skip: z.number().int().nonnegative().optional(),
                take: z.number().int().optional(),
                _count: this.makeCountAggregateInputSchema(model).optional(),
                _avg: this.makeSumAvgInputSchema(model).optional(),
                _sum: this.makeSumAvgInputSchema(model).optional(),
                _min: this.makeMinMaxInputSchema(model).optional(),
                _max: this.makeMinMaxInputSchema(model).optional(),
            })
            .strict();

        schema = schema.refine((value) => {
            const bys = typeof value.by === 'string' ? [value.by] : value.by;
            if (
                value.having &&
                Object.keys(value.having)
                    .filter((f) => !f.startsWith('_'))
                    .some((key) => !bys.includes(key))
            ) {
                return false;
            } else {
                return true;
            }
        }, 'fields in "having" must be in "by"');

        schema = schema.refine((value) => {
            const bys = typeof value.by === 'string' ? [value.by] : value.by;
            if (
                value.orderBy &&
                Object.keys(value.orderBy)
                    .filter((f) => !f.startsWith('_'))
                    .some((key) => !bys.includes(key))
            ) {
                return false;
            } else {
                return true;
            }
        }, 'fields in "orderBy" must be in "by"');

        return schema;
    }

    // #endregion

    // #region Helpers

    private refineForSelectIncludeMutuallyExclusive(schema: ZodSchema) {
        return schema.refine(
            (value) => !(value['select'] && value['include']),
            '"select" and "include" cannot be used together'
        );
    }

    private refineForSelectOmitMutuallyExclusive(schema: ZodSchema) {
        return schema.refine(
            (value) => !(value['select'] && value['omit']),
            '"select" and "omit" cannot be used together'
        );
    }

    private nullableIf(schema: ZodSchema, nullable: boolean) {
        return nullable ? schema.nullable() : schema;
    }

    private orArray(schema: ZodSchema, canBeArray: boolean) {
        return canBeArray ? z.union([schema, z.array(schema)]) : schema;
    }

    private isNumericField(fieldDef: FieldDef) {
        return NUMERIC_FIELD_TYPES.includes(fieldDef.type) && !fieldDef.array;
    }

    // #endregion
}
