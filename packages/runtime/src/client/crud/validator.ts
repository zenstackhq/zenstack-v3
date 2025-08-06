import { invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
import stableStringify from 'json-stable-stringify';
import { match, P } from 'ts-pattern';
import { z, ZodType } from 'zod';
import { type BuiltinType, type EnumDef, type FieldDef, type GetModels, type SchemaDef } from '../../schema';
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
    type UpdateManyAndReturnArgs,
    type UpdateManyArgs,
    type UpsertArgs,
} from '../crud-types';
import { InputValidationError, InternalError, QueryError } from '../errors';
import {
    fieldHasDefaultValue,
    getDiscriminatorField,
    getEnum,
    getModel,
    getUniqueFields,
    requireField,
    requireModel,
} from '../query-utils';

type GetSchemaFunc<Schema extends SchemaDef, Options> = (model: GetModels<Schema>, options: Options) => ZodType;

export class InputValidator<Schema extends SchemaDef> {
    private schemaCache = new Map<string, ZodType>();

    constructor(private readonly schema: Schema) {}

    validateFindArgs(model: GetModels<Schema>, unique: boolean, args: unknown) {
        return this.validate<FindArgs<Schema, GetModels<Schema>, true>, Parameters<typeof this.makeFindSchema>[1]>(
            model,
            'find',
            { unique, collection: true },
            (model, options) => this.makeFindSchema(model, options),
            args,
        );
    }

    validateCreateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CreateArgs<Schema, GetModels<Schema>>>(
            model,
            'create',
            undefined,
            (model) => this.makeCreateSchema(model),
            args,
        );
    }

    validateCreateManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CreateManyArgs<Schema, GetModels<Schema>>, undefined>(
            model,
            'createMany',
            undefined,
            (model) => this.makeCreateManySchema(model),
            args,
        );
    }

    validateCreateManyAndReturnArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CreateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'createManyAndReturn',
            undefined,
            (model) => this.makeCreateManyAndReturnSchema(model),
            args,
        );
    }

    validateUpdateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpdateArgs<Schema, GetModels<Schema>>>(
            model,
            'update',
            undefined,
            (model) => this.makeUpdateSchema(model),
            args,
        );
    }

    validateUpdateManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpdateManyArgs<Schema, GetModels<Schema>>>(
            model,
            'updateMany',
            undefined,
            (model) => this.makeUpdateManySchema(model),
            args,
        );
    }

    validateUpdateManyAndReturnArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpdateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'updateManyAndReturn',
            undefined,
            (model) => this.makeUpdateManyAndReturnSchema(model),
            args,
        );
    }

    validateUpsertArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<UpsertArgs<Schema, GetModels<Schema>>>(
            model,
            'upsert',
            undefined,
            (model) => this.makeUpsertSchema(model),
            args,
        );
    }

    validateDeleteArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<DeleteArgs<Schema, GetModels<Schema>>>(
            model,
            'delete',
            undefined,
            (model) => this.makeDeleteSchema(model),
            args,
        );
    }

    validateDeleteManyArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<DeleteManyArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'deleteMany',
            undefined,
            (model) => this.makeDeleteManySchema(model),
            args,
        );
    }

    validateCountArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<CountArgs<Schema, GetModels<Schema>> | undefined, undefined>(
            model,
            'count',
            undefined,
            (model) => this.makeCountSchema(model),
            args,
        );
    }

    validateAggregateArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<AggregateArgs<Schema, GetModels<Schema>>, undefined>(
            model,
            'aggregate',
            undefined,
            (model) => this.makeAggregateSchema(model),
            args,
        );
    }

    validateGroupByArgs(model: GetModels<Schema>, args: unknown) {
        return this.validate<GroupByArgs<Schema, GetModels<Schema>>, undefined>(
            model,
            'groupBy',
            undefined,
            (model) => this.makeGroupBySchema(model),
            args,
        );
    }

    private validate<T, Options = undefined>(
        model: GetModels<Schema>,
        operation: string,
        options: Options,
        getSchema: GetSchemaFunc<Schema, Options>,
        args: unknown,
    ) {
        const cacheKey = stableStringify({
            model,
            operation,
            options,
        });
        let schema = this.schemaCache.get(cacheKey!);
        if (!schema) {
            schema = getSchema(model, options);
            this.schemaCache.set(cacheKey!, schema);
        }
        const { error } = schema.safeParse(args);
        if (error) {
            throw new InputValidationError(`Invalid ${operation} args: ${error.message}`, error);
        }
        return args as T;
    }

    // #region Find

    private makeFindSchema(model: string, options: { unique: boolean; collection: boolean }) {
        const fields: Record<string, z.ZodSchema> = {};
        const where = this.makeWhereSchema(model, options.unique);
        if (options.unique) {
            fields['where'] = where;
        } else {
            fields['where'] = where.optional();
        }

        fields['select'] = this.makeSelectSchema(model).optional();
        fields['include'] = this.makeIncludeSchema(model).optional();
        fields['omit'] = this.makeOmitSchema(model).optional();
        fields['distinct'] = this.makeDistinctSchema(model).optional();
        fields['cursor'] = this.makeCursorSchema(model).optional();

        if (options.collection) {
            fields['skip'] = this.makeSkipSchema().optional();
            fields['take'] = this.makeTakeSchema().optional();
            fields['orderBy'] = this.orArray(this.makeOrderBySchema(model, true, false), true).optional();
        }

        let result: ZodType = z.strictObject(fields);
        result = this.refineForSelectIncludeMutuallyExclusive(result);
        result = this.refineForSelectOmitMutuallyExclusive(result);

        if (!options.unique) {
            result = result.optional();
        }
        return result;
    }

    private makePrimitiveSchema(type: string) {
        if (this.schema.typeDefs && type in this.schema.typeDefs) {
            return this.makeTypeDefSchema(type);
        } else {
            return match(type)
                .with('String', () => z.string())
                .with('Int', () => z.number())
                .with('Float', () => z.number())
                .with('Boolean', () => z.boolean())
                .with('BigInt', () => z.union([z.number(), z.bigint()]))
                .with('Decimal', () => z.union([z.number(), z.instanceof(Decimal), z.string()]))
                .with('DateTime', () => z.union([z.date(), z.string().datetime()]))
                .with('Bytes', () => z.instanceof(Uint8Array))
                .otherwise(() => z.unknown());
        }
    }

    private makeTypeDefSchema(type: string): z.ZodType {
        const key = `$typedef-${type}`;
        let schema = this.schemaCache.get(key);
        if (schema) {
            return schema;
        }
        const typeDef = this.schema.typeDefs?.[type];
        invariant(typeDef, `Type definition "${type}" not found in schema`);
        schema = z.looseObject(
            Object.fromEntries(
                Object.entries(typeDef.fields).map(([field, def]) => {
                    let fieldSchema = this.makePrimitiveSchema(def.type);
                    if (def.array) {
                        fieldSchema = fieldSchema.array();
                    }
                    if (def.optional) {
                        fieldSchema = fieldSchema.optional();
                    }
                    return [field, fieldSchema];
                }),
            ),
        );
        this.schemaCache.set(key, schema);
        return schema;
    }

    private makeWhereSchema(model: string, unique: boolean, withoutRelationFields = false): ZodType {
        const modelDef = getModel(this.schema, model);
        if (!modelDef) {
            throw new QueryError(`Model "${model}" not found in schema`);
        }

        const fields: Record<string, any> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            let fieldSchema: ZodType | undefined;

            if (fieldDef.relation) {
                if (withoutRelationFields) {
                    continue;
                }
                fieldSchema = z.lazy(() => this.makeWhereSchema(fieldDef.type, false).optional());

                // optional to-one relation allows null
                fieldSchema = this.nullableIf(fieldSchema, !fieldDef.array && !!fieldDef.optional);

                if (fieldDef.array) {
                    // to-many relation
                    fieldSchema = z.union([
                        fieldSchema,
                        z.strictObject({
                            some: fieldSchema.optional(),
                            every: fieldSchema.optional(),
                            none: fieldSchema.optional(),
                        }),
                    ]);
                } else {
                    // to-one relation
                    fieldSchema = z.union([
                        fieldSchema,
                        z.strictObject({
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
                        fieldSchema = this.makeEnumFilterSchema(enumDef, !!fieldDef.optional);
                    }
                } else if (fieldDef.array) {
                    // array field
                    fieldSchema = this.makeArrayFilterSchema(fieldDef.type as BuiltinType);
                } else {
                    // primitive field
                    fieldSchema = this.makePrimitiveFilterSchema(fieldDef.type as BuiltinType, !!fieldDef.optional);
                }
            }

            if (fieldSchema) {
                fields[field] = fieldSchema.optional();
            }
        }

        if (unique) {
            // add compound unique fields, e.g. `{ id1_id2: { id1: 1, id2: 1 } }`
            const uniqueFields = getUniqueFields(this.schema, model);
            for (const uniqueField of uniqueFields) {
                if ('defs' in uniqueField) {
                    fields[uniqueField.name] = z
                        .object(
                            Object.fromEntries(
                                Object.entries(uniqueField.defs).map(([key, def]) => {
                                    invariant(!def.relation, 'unique field cannot be a relation');
                                    let fieldSchema: ZodType;
                                    const enumDef = getEnum(this.schema, def.type);
                                    if (enumDef) {
                                        // enum
                                        if (Object.keys(enumDef).length > 0) {
                                            fieldSchema = this.makeEnumFilterSchema(enumDef, !!def.optional);
                                        } else {
                                            fieldSchema = z.never();
                                        }
                                    } else {
                                        // regular field
                                        fieldSchema = this.makePrimitiveFilterSchema(
                                            def.type as BuiltinType,
                                            !!def.optional,
                                        );
                                    }
                                    return [key, fieldSchema];
                                }),
                            ),
                        )
                        .optional();
                }
            }
        }

        // expression builder
        fields['$expr'] = z.custom((v) => typeof v === 'function').optional();

        // logical operators
        fields['AND'] = this.orArray(
            z.lazy(() => this.makeWhereSchema(model, false, withoutRelationFields)),
            true,
        ).optional();
        fields['OR'] = z
            .lazy(() => this.makeWhereSchema(model, false, withoutRelationFields))
            .array()
            .optional();
        fields['NOT'] = this.orArray(
            z.lazy(() => this.makeWhereSchema(model, false, withoutRelationFields)),
            true,
        ).optional();

        const baseWhere = z.strictObject(fields);
        let result: ZodType = baseWhere;

        if (unique) {
            // requires at least one unique field (field set) is required
            const uniqueFields = getUniqueFields(this.schema, model);
            if (uniqueFields.length === 0) {
                throw new InternalError(`Model "${model}" has no unique fields`);
            }

            if (uniqueFields.length === 1) {
                // only one unique field (set), mark the field(s) required
                result = baseWhere.required({
                    [uniqueFields[0]!.name]: true,
                } as any);
            } else {
                result = baseWhere.refine((value) => {
                    // check that at least one unique field is set
                    return uniqueFields.some(({ name }) => value[name] !== undefined);
                }, `At least one unique field or field set must be set`);
            }
        }

        return result;
    }

    private makeEnumFilterSchema(enumDef: EnumDef, optional: boolean) {
        const baseSchema = z.enum(Object.keys(enumDef) as [string, ...string[]]);
        const components = this.makeCommonPrimitiveFilterComponents(baseSchema, optional, () =>
            z.lazy(() => this.makeEnumFilterSchema(enumDef, optional)),
        );
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.strictObject({
                equals: components.equals,
                in: components.in,
                notIn: components.notIn,
                not: components.not,
            }),
        ]);
    }

    private makeArrayFilterSchema(type: BuiltinType) {
        return z.strictObject({
            equals: this.makePrimitiveSchema(type).array().optional(),
            has: this.makePrimitiveSchema(type).optional(),
            hasEvery: this.makePrimitiveSchema(type).array().optional(),
            hasSome: this.makePrimitiveSchema(type).array().optional(),
            isEmpty: z.boolean().optional(),
        });
    }

    private makePrimitiveFilterSchema(type: BuiltinType, optional: boolean) {
        if (this.schema.typeDefs && type in this.schema.typeDefs) {
            // typed JSON field
            return this.makeTypeDefFilterSchema(type, optional);
        }
        return (
            match(type)
                .with('String', () => this.makeStringFilterSchema(optional))
                .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                    this.makeNumberFilterSchema(this.makePrimitiveSchema(type), optional),
                )
                .with('Boolean', () => this.makeBooleanFilterSchema(optional))
                .with('DateTime', () => this.makeDateTimeFilterSchema(optional))
                .with('Bytes', () => this.makeBytesFilterSchema(optional))
                // TODO: JSON filters
                .with('Json', () => z.any())
                .with('Unsupported', () => z.never())
                .exhaustive()
        );
    }

    private makeTypeDefFilterSchema(_type: string, _optional: boolean) {
        // TODO: strong typed JSON filtering
        return z.never();
    }

    private makeDateTimeFilterSchema(optional: boolean): ZodType {
        return this.makeCommonPrimitiveFilterSchema(z.union([z.string().datetime(), z.date()]), optional, () =>
            z.lazy(() => this.makeDateTimeFilterSchema(optional)),
        );
    }

    private makeBooleanFilterSchema(optional: boolean): ZodType {
        return z.union([
            this.nullableIf(z.boolean(), optional),
            z.strictObject({
                equals: this.nullableIf(z.boolean(), optional).optional(),
                not: z.lazy(() => this.makeBooleanFilterSchema(optional)).optional(),
            }),
        ]);
    }

    private makeBytesFilterSchema(optional: boolean): ZodType {
        const baseSchema = z.instanceof(Uint8Array);
        const components = this.makeCommonPrimitiveFilterComponents(baseSchema, optional, () =>
            z.instanceof(Uint8Array),
        );
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.strictObject({
                equals: components.equals,
                in: components.in,
                notIn: components.notIn,
                not: components.not,
            }),
        ]);
    }

    private makeCommonPrimitiveFilterComponents(baseSchema: ZodType, optional: boolean, makeThis: () => ZodType) {
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

    private makeCommonPrimitiveFilterSchema(baseSchema: ZodType, optional: boolean, makeThis: () => ZodType) {
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.strictObject(this.makeCommonPrimitiveFilterComponents(baseSchema, optional, makeThis)),
        ]);
    }

    private makeNumberFilterSchema(baseSchema: ZodType, optional: boolean): ZodType {
        return this.makeCommonPrimitiveFilterSchema(baseSchema, optional, () =>
            z.lazy(() => this.makeNumberFilterSchema(baseSchema, optional)),
        );
    }

    private makeStringFilterSchema(optional: boolean): ZodType {
        return z.union([
            this.nullableIf(z.string(), optional),
            z.strictObject({
                ...this.makeCommonPrimitiveFilterComponents(z.string(), optional, () =>
                    z.lazy(() => this.makeStringFilterSchema(optional)),
                ),
                startsWith: z.string().optional(),
                endsWith: z.string().optional(),
                contains: z.string().optional(),
                ...(this.providerSupportsCaseSensitivity
                    ? {
                          mode: this.makeStringModeSchema().optional(),
                      }
                    : {}),
            }),
        ]);
    }

    private makeStringModeSchema() {
        return z.union([z.literal('default'), z.literal('insensitive')]);
    }

    private makeSelectSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodType> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.literal(true),
                        z.strictObject({
                            select: z.lazy(() => this.makeSelectSchema(fieldDef.type)).optional(),
                            include: z.lazy(() => this.makeIncludeSchema(fieldDef.type)).optional(),
                        }),
                    ])
                    .optional();
            } else {
                fields[field] = z.boolean().optional();
            }
        }

        const toManyRelations = Object.values(modelDef.fields).filter((def) => def.relation && def.array);

        if (toManyRelations.length > 0) {
            fields['_count'] = z
                .union([
                    z.literal(true),
                    z.strictObject({
                        select: z.strictObject(
                            toManyRelations.reduce(
                                (acc, fieldDef) => ({
                                    ...acc,
                                    [fieldDef.name]: z
                                        .union([
                                            z.boolean(),
                                            z.strictObject({
                                                where: this.makeWhereSchema(fieldDef.type, false, false),
                                            }),
                                        ])
                                        .optional(),
                                }),
                                {} as Record<string, ZodType>,
                            ),
                        ),
                    }),
                ])
                .optional();
        }

        return z.strictObject(fields);
    }

    private makeOmitSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodType> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (!fieldDef.relation) {
                fields[field] = z.boolean().optional();
            }
        }
        return z.strictObject(fields);
    }

    private makeIncludeSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodType> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                fields[field] = z
                    .union([
                        z.literal(true),
                        z.strictObject({
                            select: z.lazy(() => this.makeSelectSchema(fieldDef.type)).optional(),
                            include: z.lazy(() => this.makeIncludeSchema(fieldDef.type)).optional(),
                            omit: z.lazy(() => this.makeOmitSchema(fieldDef.type)).optional(),
                            where: z.lazy(() => this.makeWhereSchema(fieldDef.type, false)).optional(),
                            orderBy: z.lazy(() => this.makeOrderBySchema(fieldDef.type, true, false)).optional(),
                            skip: this.makeSkipSchema().optional(),
                            take: this.makeTakeSchema().optional(),
                            distinct: this.makeDistinctSchema(fieldDef.type).optional(),
                        }),
                    ])
                    .optional();
            }
        }

        return z.strictObject(fields);
    }

    private makeOrderBySchema(model: string, withRelation: boolean, WithAggregation: boolean) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodType> = {};
        const sort = z.union([z.literal('asc'), z.literal('desc')]);
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.relation) {
                // relations
                if (withRelation) {
                    fields[field] = z.lazy(() => {
                        let relationOrderBy = this.makeOrderBySchema(fieldDef.type, withRelation, WithAggregation);
                        if (fieldDef.array) {
                            relationOrderBy = relationOrderBy.extend({
                                _count: sort,
                            });
                        }
                        return relationOrderBy.optional();
                    });
                }
            } else {
                // scalars
                if (fieldDef.optional) {
                    fields[field] = z
                        .union([
                            sort,
                            z.strictObject({
                                sort,
                                nulls: z.union([z.literal('first'), z.literal('last')]),
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
            const aggregationFields = ['_count', '_avg', '_sum', '_min', '_max'];
            for (const agg of aggregationFields) {
                fields[agg] = z.lazy(() => this.makeOrderBySchema(model, true, false).optional());
            }
        }

        return z.strictObject(fields);
    }

    private makeDistinctSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const nonRelationFields = Object.keys(modelDef.fields).filter((field) => !modelDef.fields[field]?.relation);
        return this.orArray(z.enum(nonRelationFields as any), true);
    }

    private makeCursorSchema(model: string) {
        return this.makeWhereSchema(model, true, true).optional();
    }

    // #endregion

    // #region Create

    private makeCreateSchema(model: string) {
        const dataSchema = this.makeCreateDataSchema(model, false);
        const schema = z.object({
            data: dataSchema,
            select: this.makeSelectSchema(model).optional(),
            include: this.makeIncludeSchema(model).optional(),
            omit: this.makeOmitSchema(model).optional(),
        });
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeCreateManySchema(model: string) {
        return this.makeCreateManyDataSchema(model, []).optional();
    }

    private makeCreateManyAndReturnSchema(model: string) {
        const base = this.makeCreateManyDataSchema(model, []);
        const result = base.merge(
            z.strictObject({
                select: this.makeSelectSchema(model).optional(),
                omit: this.makeOmitSchema(model).optional(),
            }),
        );
        return this.refineForSelectOmitMutuallyExclusive(result).optional();
    }

    private makeCreateDataSchema(
        model: string,
        canBeArray: boolean,
        withoutFields: string[] = [],
        withoutRelationFields = false,
    ) {
        const uncheckedVariantFields: Record<string, ZodType> = {};
        const checkedVariantFields: Record<string, ZodType> = {};
        const modelDef = requireModel(this.schema, model);
        const hasRelation =
            !withoutRelationFields &&
            Object.entries(modelDef.fields).some(([f, def]) => !withoutFields.includes(f) && def.relation);

        Object.keys(modelDef.fields).forEach((field) => {
            if (withoutFields.includes(field)) {
                return;
            }
            const fieldDef = requireField(this.schema, model, field);
            if (fieldDef.computed) {
                return;
            }

            if (this.isDelegateDiscriminator(fieldDef)) {
                // discriminator field is auto-assigned
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
                    const oppositeFieldDef = requireField(this.schema, fieldDef.type, oppositeField);
                    if (oppositeFieldDef.relation?.fields) {
                        excludeFields.push(...oppositeFieldDef.relation.fields);
                    }
                }

                let fieldSchema: ZodType = z.lazy(() =>
                    this.makeRelationManipulationSchema(fieldDef, excludeFields, 'create'),
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
                            return fkDef.optional || fieldHasDefaultValue(fkDef);
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
                checkedVariantFields[field] = fieldSchema;
                if (fieldDef.array || !fieldDef.relation.references) {
                    // non-owned relation
                    uncheckedVariantFields[field] = fieldSchema;
                }
            } else {
                let fieldSchema: ZodType = this.makePrimitiveSchema(fieldDef.type);

                if (fieldDef.array) {
                    fieldSchema = z
                        .union([
                            z.array(fieldSchema),
                            z.strictObject({
                                set: z.array(fieldSchema),
                            }),
                        ])
                        .optional();
                }

                if (fieldDef.optional || fieldHasDefaultValue(fieldDef)) {
                    fieldSchema = fieldSchema.optional();
                }

                if (fieldDef.optional) {
                    fieldSchema = fieldSchema.nullable();
                }

                uncheckedVariantFields[field] = fieldSchema;
                if (!fieldDef.foreignKeyFor) {
                    // non-fk field
                    checkedVariantFields[field] = fieldSchema;
                }
            }
        });

        if (!hasRelation) {
            return this.orArray(z.strictObject(uncheckedVariantFields), canBeArray);
        } else {
            return z.union([
                z.strictObject(uncheckedVariantFields),
                z.strictObject(checkedVariantFields),
                ...(canBeArray ? [z.array(z.strictObject(uncheckedVariantFields))] : []),
                ...(canBeArray ? [z.array(z.strictObject(checkedVariantFields))] : []),
            ]);
        }
    }

    private isDelegateDiscriminator(fieldDef: FieldDef) {
        if (!fieldDef.originModel) {
            // not inherited from a delegate
            return false;
        }
        const discriminatorField = getDiscriminatorField(this.schema, fieldDef.originModel);
        return discriminatorField === fieldDef.name;
    }

    private makeRelationManipulationSchema(fieldDef: FieldDef, withoutFields: string[], mode: 'create' | 'update') {
        const fieldType = fieldDef.type;
        const array = !!fieldDef.array;
        const fields: Record<string, ZodType> = {
            create: this.makeCreateDataSchema(fieldDef.type, !!fieldDef.array, withoutFields).optional(),

            connect: this.makeConnectDataSchema(fieldType, array).optional(),

            connectOrCreate: this.makeConnectOrCreateDataSchema(fieldType, array, withoutFields).optional(),
        };

        if (array) {
            fields['createMany'] = this.makeCreateManyDataSchema(fieldType, withoutFields).optional();
        }

        if (mode === 'update') {
            if (fieldDef.optional || fieldDef.array) {
                // disconnect and delete are only available for optional/to-many relations
                fields['disconnect'] = this.makeDisconnectDataSchema(fieldType, array).optional();

                fields['delete'] = this.makeDeleteRelationDataSchema(fieldType, array, true).optional();
            }

            fields['update'] = array
                ? this.orArray(
                      z.strictObject({
                          where: this.makeWhereSchema(fieldType, true),
                          data: this.makeUpdateDataSchema(fieldType, withoutFields),
                      }),
                      true,
                  ).optional()
                : z
                      .union([
                          z.strictObject({
                              where: this.makeWhereSchema(fieldType, true),
                              data: this.makeUpdateDataSchema(fieldType, withoutFields),
                          }),
                          this.makeUpdateDataSchema(fieldType, withoutFields),
                      ])
                      .optional();

            fields['upsert'] = this.orArray(
                z.strictObject({
                    where: this.makeWhereSchema(fieldType, true),
                    create: this.makeCreateDataSchema(fieldType, false, withoutFields),
                    update: this.makeUpdateDataSchema(fieldType, withoutFields),
                }),
                true,
            ).optional();

            if (array) {
                // to-many relation specifics
                fields['set'] = this.makeSetDataSchema(fieldType, true).optional();

                fields['updateMany'] = this.orArray(
                    z.strictObject({
                        where: this.makeWhereSchema(fieldType, false, true),
                        data: this.makeUpdateDataSchema(fieldType, withoutFields),
                    }),
                    true,
                ).optional();

                fields['deleteMany'] = this.makeDeleteRelationDataSchema(fieldType, true, false).optional();
            }
        }

        return z.strictObject(fields);
    }

    private makeSetDataSchema(model: string, canBeArray: boolean) {
        return this.orArray(this.makeWhereSchema(model, true), canBeArray);
    }

    private makeConnectDataSchema(model: string, canBeArray: boolean) {
        return this.orArray(this.makeWhereSchema(model, true), canBeArray);
    }

    private makeDisconnectDataSchema(model: string, canBeArray: boolean) {
        if (canBeArray) {
            // to-many relation, must be unique filters
            return this.orArray(this.makeWhereSchema(model, true), canBeArray);
        } else {
            // to-one relation, can be boolean or a regular filter - the entity
            // being disconnected is already uniquely identified by its parent
            return z.union([z.boolean(), this.makeWhereSchema(model, false)]);
        }
    }

    private makeDeleteRelationDataSchema(model: string, toManyRelation: boolean, uniqueFilter: boolean) {
        return toManyRelation
            ? this.orArray(this.makeWhereSchema(model, uniqueFilter), true)
            : z.union([z.boolean(), this.makeWhereSchema(model, uniqueFilter)]);
    }

    private makeConnectOrCreateDataSchema(model: string, canBeArray: boolean, withoutFields: string[]) {
        const whereSchema = this.makeWhereSchema(model, true);
        const createSchema = this.makeCreateDataSchema(model, false, withoutFields);
        return this.orArray(
            z.object({
                where: whereSchema,
                create: createSchema,
            }),
            canBeArray,
        );
    }

    private makeCreateManyDataSchema(model: string, withoutFields: string[]) {
        return z.object({
            data: this.makeCreateDataSchema(model, true, withoutFields, true),
            skipDuplicates: z.boolean().optional(),
        });
    }

    // #endregion

    // #region Update

    private makeUpdateSchema(model: string) {
        const schema = z.object({
            where: this.makeWhereSchema(model, true),
            data: this.makeUpdateDataSchema(model),
            select: this.makeSelectSchema(model).optional(),
            include: this.makeIncludeSchema(model).optional(),
            omit: this.makeOmitSchema(model).optional(),
        });
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeUpdateManySchema(model: string) {
        return z.object({
            where: this.makeWhereSchema(model, false).optional(),
            data: this.makeUpdateDataSchema(model, [], true),
            limit: z.number().int().nonnegative().optional(),
        });
    }

    private makeUpdateManyAndReturnSchema(model: string) {
        const base = this.makeUpdateManySchema(model);
        const result = base.merge(
            z.strictObject({
                select: this.makeSelectSchema(model).optional(),
                omit: this.makeOmitSchema(model).optional(),
            }),
        );
        return this.refineForSelectOmitMutuallyExclusive(result);
    }

    private makeUpsertSchema(model: string) {
        const schema = z.object({
            where: this.makeWhereSchema(model, true),
            create: this.makeCreateDataSchema(model, false),
            update: this.makeUpdateDataSchema(model),
            select: this.makeSelectSchema(model).optional(),
            include: this.makeIncludeSchema(model).optional(),
            omit: this.makeOmitSchema(model).optional(),
        });
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeUpdateDataSchema(model: string, withoutFields: string[] = [], withoutRelationFields = false) {
        const uncheckedVariantFields: Record<string, ZodType> = {};
        const checkedVariantFields: Record<string, ZodType> = {};
        const modelDef = requireModel(this.schema, model);
        const hasRelation = Object.entries(modelDef.fields).some(
            ([key, value]) => value.relation && !withoutFields.includes(key),
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
                    const oppositeFieldDef = requireField(this.schema, fieldDef.type, oppositeField);
                    if (oppositeFieldDef.relation?.fields) {
                        excludeFields.push(...oppositeFieldDef.relation.fields);
                    }
                }
                let fieldSchema: ZodType = z
                    .lazy(() => this.makeRelationManipulationSchema(fieldDef, excludeFields, 'update'))
                    .optional();
                // optional to-one relation can be null
                if (fieldDef.optional && !fieldDef.array) {
                    fieldSchema = fieldSchema.nullable();
                }
                checkedVariantFields[field] = fieldSchema;
                if (fieldDef.array || !fieldDef.relation.references) {
                    // non-owned relation
                    uncheckedVariantFields[field] = fieldSchema;
                }
            } else {
                let fieldSchema: ZodType = this.makePrimitiveSchema(fieldDef.type).optional();

                if (this.isNumericField(fieldDef)) {
                    fieldSchema = z.union([
                        fieldSchema,
                        z
                            .object({
                                set: this.nullableIf(z.number().optional(), !!fieldDef.optional),
                                increment: z.number().optional(),
                                decrement: z.number().optional(),
                                multiply: z.number().optional(),
                                divide: z.number().optional(),
                            })
                            .refine(
                                (v) => Object.keys(v).length === 1,
                                'Only one of "set", "increment", "decrement", "multiply", or "divide" can be provided',
                            ),
                    ]);
                }

                if (fieldDef.array) {
                    fieldSchema = z
                        .union([
                            fieldSchema.array(),
                            z
                                .object({
                                    set: z.array(fieldSchema).optional(),
                                    push: this.orArray(fieldSchema, true).optional(),
                                })
                                .refine(
                                    (v) => Object.keys(v).length === 1,
                                    'Only one of "set", "push" can be provided',
                                ),
                        ])
                        .optional();
                }

                if (fieldDef.optional) {
                    fieldSchema = fieldSchema.nullable();
                }

                uncheckedVariantFields[field] = fieldSchema;
                if (!fieldDef.foreignKeyFor) {
                    // non-fk field
                    checkedVariantFields[field] = fieldSchema;
                }
            }
        });

        if (!hasRelation) {
            return z.strictObject(uncheckedVariantFields);
        } else {
            return z.union([z.strictObject(uncheckedVariantFields), z.strictObject(checkedVariantFields)]);
        }
    }

    // #endregion

    // #region Delete

    private makeDeleteSchema(model: GetModels<Schema>) {
        const schema = z.object({
            where: this.makeWhereSchema(model, true),
            select: this.makeSelectSchema(model).optional(),
            include: this.makeIncludeSchema(model).optional(),
        });
        return this.refineForSelectIncludeMutuallyExclusive(schema);
    }

    private makeDeleteManySchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                limit: z.number().int().nonnegative().optional(),
            })

            .optional();
    }

    // #endregion

    // #region Count

    makeCountSchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                skip: this.makeSkipSchema().optional(),
                take: this.makeTakeSchema().optional(),
                orderBy: this.orArray(this.makeOrderBySchema(model, true, false), true).optional(),
                select: this.makeCountAggregateInputSchema(model).optional(),
            })

            .optional();
    }

    private makeCountAggregateInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.union([
            z.literal(true),
            z.object({
                _all: z.literal(true).optional(),
                ...Object.keys(modelDef.fields).reduce(
                    (acc, field) => {
                        acc[field] = z.literal(true).optional();
                        return acc;
                    },
                    {} as Record<string, ZodType>,
                ),
            }),
        ]);
    }

    // #endregion

    // #region Aggregate

    makeAggregateSchema(model: GetModels<Schema>) {
        return z
            .object({
                where: this.makeWhereSchema(model, false).optional(),
                skip: this.makeSkipSchema().optional(),
                take: this.makeTakeSchema().optional(),
                orderBy: this.orArray(this.makeOrderBySchema(model, true, false), true).optional(),
                _count: this.makeCountAggregateInputSchema(model).optional(),
                _avg: this.makeSumAvgInputSchema(model).optional(),
                _sum: this.makeSumAvgInputSchema(model).optional(),
                _min: this.makeMinMaxInputSchema(model).optional(),
                _max: this.makeMinMaxInputSchema(model).optional(),
            })

            .optional();
    }

    makeSumAvgInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.strictObject(
            Object.keys(modelDef.fields).reduce(
                (acc, field) => {
                    const fieldDef = requireField(this.schema, model, field);
                    if (this.isNumericField(fieldDef)) {
                        acc[field] = z.literal(true).optional();
                    }
                    return acc;
                },
                {} as Record<string, ZodType>,
            ),
        );
    }

    makeMinMaxInputSchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        return z.strictObject(
            Object.keys(modelDef.fields).reduce(
                (acc, field) => {
                    const fieldDef = requireField(this.schema, model, field);
                    if (!fieldDef.relation && !fieldDef.array) {
                        acc[field] = z.literal(true).optional();
                    }
                    return acc;
                },
                {} as Record<string, ZodType>,
            ),
        );
    }

    private makeGroupBySchema(model: GetModels<Schema>) {
        const modelDef = requireModel(this.schema, model);
        const nonRelationFields = Object.keys(modelDef.fields).filter((field) => !modelDef.fields[field]?.relation);

        let schema = z.object({
            where: this.makeWhereSchema(model, false).optional(),
            orderBy: this.orArray(this.makeOrderBySchema(model, false, true), true).optional(),
            by: this.orArray(z.enum(nonRelationFields), true),
            having: this.makeWhereSchema(model, false, true).optional(),
            skip: this.makeSkipSchema().optional(),
            take: this.makeTakeSchema().optional(),
            _count: this.makeCountAggregateInputSchema(model).optional(),
            _avg: this.makeSumAvgInputSchema(model).optional(),
            _sum: this.makeSumAvgInputSchema(model).optional(),
            _min: this.makeMinMaxInputSchema(model).optional(),
            _max: this.makeMinMaxInputSchema(model).optional(),
        });
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

    private makeSkipSchema() {
        return z.number().int().nonnegative();
    }

    private makeTakeSchema() {
        return z.number().int();
    }

    private refineForSelectIncludeMutuallyExclusive(schema: ZodType) {
        return schema.refine(
            (value: any) => !(value['select'] && value['include']),
            '"select" and "include" cannot be used together',
        );
    }

    private refineForSelectOmitMutuallyExclusive(schema: ZodType) {
        return schema.refine(
            (value: any) => !(value['select'] && value['omit']),
            '"select" and "omit" cannot be used together',
        );
    }

    private nullableIf(schema: ZodType, nullable: boolean) {
        return nullable ? schema.nullable() : schema;
    }

    private orArray<T extends ZodType>(schema: T, canBeArray: boolean) {
        return canBeArray ? z.union([schema, z.array(schema)]) : schema;
    }

    private isNumericField(fieldDef: FieldDef) {
        return NUMERIC_FIELD_TYPES.includes(fieldDef.type) && !fieldDef.array;
    }

    private get providerSupportsCaseSensitivity() {
        return this.schema.provider.type === 'postgresql';
    }
    // #endregion
}
