import { enumerate, invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
import stableStringify from 'json-stable-stringify';
import { match, P } from 'ts-pattern';
import { z, ZodType } from 'zod';
import { AnyNullClass, DbNullClass, JsonNullClass } from '../../../common-types';
import {
    type AttributeApplication,
    type BuiltinType,
    type EnumDef,
    type FieldDef,
    type GetModels,
    type ModelDef,
    type SchemaDef,
} from '../../../schema';
import { extractFields } from '../../../utils/object-utils';
import { formatError } from '../../../utils/zod-utils';
import { AGGREGATE_OPERATORS, LOGICAL_COMBINATORS, NUMERIC_FIELD_TYPES } from '../../constants';
import type { ClientContract } from '../../contract';
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
} from '../../crud-types';
import { createInternalError, createInvalidInputError } from '../../errors';
import {
    fieldHasDefaultValue,
    getDiscriminatorField,
    getEnum,
    getTypeDef,
    getUniqueFields,
    requireField,
    requireModel,
} from '../../query-utils';
import {
    addBigIntValidation,
    addCustomValidation,
    addDecimalValidation,
    addListValidation,
    addNumberValidation,
    addStringValidation,
} from './utils';

const schemaCache = new WeakMap<SchemaDef, Map<string, ZodType>>();

type GetSchemaFunc<Schema extends SchemaDef, Options> = (model: GetModels<Schema>, options: Options) => ZodType;

export class InputValidator<Schema extends SchemaDef> {
    constructor(private readonly client: ClientContract<Schema>) {}

    private get schema() {
        return this.client.$schema;
    }

    private get options() {
        return this.client.$options;
    }

    private get extraValidationsEnabled() {
        return this.client.$options.validateInput !== false;
    }

    validateFindArgs(
        model: GetModels<Schema>,
        args: unknown,
        options: { unique: boolean; findOne: boolean },
    ): FindArgs<Schema, GetModels<Schema>, true> | undefined {
        return this.validate<
            FindArgs<Schema, GetModels<Schema>, true> | undefined,
            Parameters<typeof this.makeFindSchema>[1]
        >(model, 'find', options, (model, options) => this.makeFindSchema(model, options), args);
    }

    validateCreateArgs(model: GetModels<Schema>, args: unknown): CreateArgs<Schema, GetModels<Schema>> {
        return this.validate<CreateArgs<Schema, GetModels<Schema>>>(
            model,
            'create',
            undefined,
            (model) => this.makeCreateSchema(model),
            args,
        );
    }

    validateCreateManyArgs(model: GetModels<Schema>, args: unknown): CreateManyArgs<Schema, GetModels<Schema>> {
        return this.validate<CreateManyArgs<Schema, GetModels<Schema>>>(
            model,
            'createMany',
            undefined,
            (model) => this.makeCreateManySchema(model),
            args,
        );
    }

    validateCreateManyAndReturnArgs(
        model: GetModels<Schema>,
        args: unknown,
    ): CreateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined {
        return this.validate<CreateManyAndReturnArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'createManyAndReturn',
            undefined,
            (model) => this.makeCreateManyAndReturnSchema(model),
            args,
        );
    }

    validateUpdateArgs(model: GetModels<Schema>, args: unknown): UpdateArgs<Schema, GetModels<Schema>> {
        return this.validate<UpdateArgs<Schema, GetModels<Schema>>>(
            model,
            'update',
            undefined,
            (model) => this.makeUpdateSchema(model),
            args,
        );
    }

    validateUpdateManyArgs(model: GetModels<Schema>, args: unknown): UpdateManyArgs<Schema, GetModels<Schema>> {
        return this.validate<UpdateManyArgs<Schema, GetModels<Schema>>>(
            model,
            'updateMany',
            undefined,
            (model) => this.makeUpdateManySchema(model),
            args,
        );
    }

    validateUpdateManyAndReturnArgs(
        model: GetModels<Schema>,
        args: unknown,
    ): UpdateManyAndReturnArgs<Schema, GetModels<Schema>> {
        return this.validate<UpdateManyAndReturnArgs<Schema, GetModels<Schema>>>(
            model,
            'updateManyAndReturn',
            undefined,
            (model) => this.makeUpdateManyAndReturnSchema(model),
            args,
        );
    }

    validateUpsertArgs(model: GetModels<Schema>, args: unknown): UpsertArgs<Schema, GetModels<Schema>> {
        return this.validate<UpsertArgs<Schema, GetModels<Schema>>>(
            model,
            'upsert',
            undefined,
            (model) => this.makeUpsertSchema(model),
            args,
        );
    }

    validateDeleteArgs(model: GetModels<Schema>, args: unknown): DeleteArgs<Schema, GetModels<Schema>> {
        return this.validate<DeleteArgs<Schema, GetModels<Schema>>>(
            model,
            'delete',
            undefined,
            (model) => this.makeDeleteSchema(model),
            args,
        );
    }

    validateDeleteManyArgs(
        model: GetModels<Schema>,
        args: unknown,
    ): DeleteManyArgs<Schema, GetModels<Schema>> | undefined {
        return this.validate<DeleteManyArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'deleteMany',
            undefined,
            (model) => this.makeDeleteManySchema(model),
            args,
        );
    }

    validateCountArgs(model: GetModels<Schema>, args: unknown): CountArgs<Schema, GetModels<Schema>> | undefined {
        return this.validate<CountArgs<Schema, GetModels<Schema>> | undefined>(
            model,
            'count',
            undefined,
            (model) => this.makeCountSchema(model),
            args,
        );
    }

    validateAggregateArgs(model: GetModels<Schema>, args: unknown): AggregateArgs<Schema, GetModels<Schema>> {
        return this.validate<AggregateArgs<Schema, GetModels<Schema>>>(
            model,
            'aggregate',
            undefined,
            (model) => this.makeAggregateSchema(model),
            args,
        );
    }

    validateGroupByArgs(model: GetModels<Schema>, args: unknown): GroupByArgs<Schema, GetModels<Schema>> {
        return this.validate<GroupByArgs<Schema, GetModels<Schema>>>(
            model,
            'groupBy',
            undefined,
            (model) => this.makeGroupBySchema(model),
            args,
        );
    }

    private getSchemaCache(cacheKey: string) {
        let thisCache = schemaCache.get(this.schema);
        if (!thisCache) {
            thisCache = new Map<string, ZodType>();
            schemaCache.set(this.schema, thisCache);
        }
        return thisCache.get(cacheKey);
    }

    private setSchemaCache(cacheKey: string, schema: ZodType) {
        let thisCache = schemaCache.get(this.schema);
        if (!thisCache) {
            thisCache = new Map<string, ZodType>();
            schemaCache.set(this.schema, thisCache);
        }
        return thisCache.set(cacheKey, schema);
    }

    private validate<T, Options = undefined>(
        model: GetModels<Schema>,
        operation: string,
        options: Options,
        getSchema: GetSchemaFunc<Schema, Options>,
        args: unknown,
    ) {
        const cacheKey = stableStringify({
            type: 'model',
            model,
            operation,
            options,
            extraValidationsEnabled: this.extraValidationsEnabled,
        });
        let schema = this.getSchemaCache(cacheKey!);
        if (!schema) {
            schema = getSchema(model, options);
            this.setSchemaCache(cacheKey!, schema);
        }
        const { error, data } = schema.safeParse(args);
        if (error) {
            throw createInvalidInputError(
                `Invalid ${operation} args for model "${model}": ${formatError(error)}`,
                model,
                {
                    cause: error,
                },
            );
        }
        return data as T;
    }

    // #region Find

    private makeFindSchema(model: string, options: { unique: boolean; findOne: boolean }) {
        const fields: Record<string, z.ZodSchema> = {};
        const where = this.makeWhereSchema(model, options.unique);
        if (options.unique) {
            fields['where'] = where;
        } else {
            fields['where'] = where.optional();
        }

        fields['select'] = this.makeSelectSchema(model).optional().nullable();
        fields['include'] = this.makeIncludeSchema(model).optional().nullable();
        fields['omit'] = this.makeOmitSchema(model).optional().nullable();

        if (!options.unique) {
            fields['skip'] = this.makeSkipSchema().optional();
            if (options.findOne) {
                fields['take'] = z.literal(1).optional();
            } else {
                fields['take'] = this.makeTakeSchema().optional();
            }
            fields['orderBy'] = this.orArray(this.makeOrderBySchema(model, true, false), true).optional();
            fields['cursor'] = this.makeCursorSchema(model).optional();
            fields['distinct'] = this.makeDistinctSchema(model).optional();
        }

        let result: ZodType = z.strictObject(fields);
        result = this.refineForSelectIncludeMutuallyExclusive(result);
        result = this.refineForSelectOmitMutuallyExclusive(result);

        if (!options.unique) {
            result = result.optional();
        }
        return result;
    }

    private makeScalarSchema(type: string, attributes?: readonly AttributeApplication[]) {
        if (this.schema.typeDefs && type in this.schema.typeDefs) {
            return this.makeTypeDefSchema(type);
        } else if (this.schema.enums && type in this.schema.enums) {
            return this.makeEnumSchema(type);
        } else {
            return match(type)
                .with('String', () =>
                    this.extraValidationsEnabled ? addStringValidation(z.string(), attributes) : z.string(),
                )
                .with('Int', () =>
                    this.extraValidationsEnabled ? addNumberValidation(z.number().int(), attributes) : z.number().int(),
                )
                .with('Float', () =>
                    this.extraValidationsEnabled ? addNumberValidation(z.number(), attributes) : z.number(),
                )
                .with('Boolean', () => z.boolean())
                .with('BigInt', () =>
                    z.union([
                        this.extraValidationsEnabled
                            ? addNumberValidation(z.number().int(), attributes)
                            : z.number().int(),
                        this.extraValidationsEnabled ? addBigIntValidation(z.bigint(), attributes) : z.bigint(),
                    ]),
                )
                .with('Decimal', () => {
                    return z.union([
                        this.extraValidationsEnabled ? addNumberValidation(z.number(), attributes) : z.number(),
                        addDecimalValidation(z.instanceof(Decimal), attributes, this.extraValidationsEnabled),
                        addDecimalValidation(z.string(), attributes, this.extraValidationsEnabled),
                    ]);
                })
                .with('DateTime', () => z.union([z.date(), z.iso.datetime()]))
                .with('Bytes', () => z.instanceof(Uint8Array))
                .with('Json', () => this.makeJsonValueSchema(false, false))
                .otherwise(() => z.unknown());
        }
    }

    private makeEnumSchema(type: string) {
        const key = stableStringify({
            type: 'enum',
            name: type,
        });
        let schema = this.getSchemaCache(key!);
        if (schema) {
            return schema;
        }
        const enumDef = getEnum(this.schema, type);
        invariant(enumDef, `Enum "${type}" not found in schema`);
        schema = z.enum(Object.keys(enumDef.values) as [string, ...string[]]);
        this.setSchemaCache(key!, schema);
        return schema;
    }

    private makeTypeDefSchema(type: string): z.ZodType {
        const key = stableStringify({
            type: 'typedef',
            name: type,
            extraValidationsEnabled: this.extraValidationsEnabled,
        });
        let schema = this.getSchemaCache(key!);
        if (schema) {
            return schema;
        }
        const typeDef = getTypeDef(this.schema, type);
        invariant(typeDef, `Type definition "${type}" not found in schema`);
        schema = z.looseObject(
            Object.fromEntries(
                Object.entries(typeDef.fields).map(([field, def]) => {
                    let fieldSchema = this.makeScalarSchema(def.type);
                    if (def.array) {
                        fieldSchema = fieldSchema.array();
                    }
                    if (def.optional) {
                        fieldSchema = fieldSchema.nullish();
                    }
                    return [field, fieldSchema];
                }),
            ),
        );

        // zod doesn't preserve object field order after parsing, here we use a
        // validation-only custom schema and use the original data if parsing
        // is successful
        const finalSchema = z.any().superRefine((value, ctx) => {
            const parseResult = schema.safeParse(value);
            if (!parseResult.success) {
                parseResult.error.issues.forEach((issue) => ctx.addIssue(issue as any));
            }
        });

        this.setSchemaCache(key!, finalSchema);
        return finalSchema;
    }

    private makeWhereSchema(
        model: string,
        unique: boolean,
        withoutRelationFields = false,
        withAggregations = false,
    ): ZodType {
        const modelDef = requireModel(this.schema, model);

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
                    if (Object.keys(enumDef.values).length > 0) {
                        fieldSchema = this.makeEnumFilterSchema(enumDef, !!fieldDef.optional, withAggregations);
                    }
                } else if (fieldDef.array) {
                    // array field
                    fieldSchema = this.makeArrayFilterSchema(fieldDef.type as BuiltinType);
                } else if (this.isTypeDefType(fieldDef.type)) {
                    fieldSchema = this.makeTypedJsonFilterSchema(fieldDef.type, !!fieldDef.optional, !!fieldDef.array);
                } else {
                    // primitive field
                    fieldSchema = this.makePrimitiveFilterSchema(
                        fieldDef.type as BuiltinType,
                        !!fieldDef.optional,
                        withAggregations,
                    );
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
                                        if (Object.keys(enumDef.values).length > 0) {
                                            fieldSchema = this.makeEnumFilterSchema(enumDef, !!def.optional, false);
                                        } else {
                                            fieldSchema = z.never();
                                        }
                                    } else {
                                        // regular field
                                        fieldSchema = this.makePrimitiveFilterSchema(
                                            def.type as BuiltinType,
                                            !!def.optional,
                                            false,
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
                throw createInternalError(`Model "${model}" has no unique fields`);
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

    private makeTypedJsonFilterSchema(type: string, optional: boolean, array: boolean) {
        const typeDef = getTypeDef(this.schema, type);
        invariant(typeDef, `Type definition "${type}" not found in schema`);

        const candidates: z.ZodType[] = [];

        if (!array) {
            // fields filter
            const fieldSchemas: Record<string, z.ZodType> = {};
            for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
                if (this.isTypeDefType(fieldDef.type)) {
                    // recursive typed JSON
                    fieldSchemas[fieldName] = this.makeTypedJsonFilterSchema(
                        fieldDef.type,
                        !!fieldDef.optional,
                        !!fieldDef.array,
                    ).optional();
                } else {
                    // array, enum, primitives
                    if (fieldDef.array) {
                        fieldSchemas[fieldName] = this.makeArrayFilterSchema(fieldDef.type as BuiltinType).optional();
                    } else {
                        const enumDef = getEnum(this.schema, fieldDef.type);
                        if (enumDef) {
                            fieldSchemas[fieldName] = this.makeEnumFilterSchema(
                                enumDef,
                                !!fieldDef.optional,
                                false,
                            ).optional();
                        } else {
                            fieldSchemas[fieldName] = this.makePrimitiveFilterSchema(
                                fieldDef.type as BuiltinType,
                                !!fieldDef.optional,
                                false,
                            ).optional();
                        }
                    }
                }
            }

            candidates.push(z.strictObject(fieldSchemas));
        }

        const recursiveSchema = z.lazy(() => this.makeTypedJsonFilterSchema(type, optional, false)).optional();
        if (array) {
            // array filter
            candidates.push(
                z.strictObject({
                    some: recursiveSchema,
                    every: recursiveSchema,
                    none: recursiveSchema,
                }),
            );
        } else {
            // is / isNot filter
            candidates.push(
                z.strictObject({
                    is: recursiveSchema,
                    isNot: recursiveSchema,
                }),
            );
        }

        // plain json filter
        candidates.push(this.makeJsonFilterSchema(optional));

        if (optional) {
            // allow null as well
            candidates.push(z.null());
        }

        // either plain json filter or field filters
        return z.union(candidates);
    }

    private isTypeDefType(type: string) {
        return this.schema.typeDefs && type in this.schema.typeDefs;
    }

    private makeEnumFilterSchema(enumDef: EnumDef, optional: boolean, withAggregations: boolean) {
        const baseSchema = z.enum(Object.keys(enumDef.values) as [string, ...string[]]);
        const components = this.makeCommonPrimitiveFilterComponents(
            baseSchema,
            optional,
            () => z.lazy(() => this.makeEnumFilterSchema(enumDef, optional, withAggregations)),
            ['equals', 'in', 'notIn', 'not'],
            withAggregations ? ['_count', '_min', '_max'] : undefined,
        );
        return z.union([this.nullableIf(baseSchema, optional), z.strictObject(components)]);
    }

    private makeArrayFilterSchema(type: BuiltinType) {
        return z.strictObject({
            equals: this.makeScalarSchema(type).array().optional(),
            has: this.makeScalarSchema(type).optional(),
            hasEvery: this.makeScalarSchema(type).array().optional(),
            hasSome: this.makeScalarSchema(type).array().optional(),
            isEmpty: z.boolean().optional(),
        });
    }

    private makePrimitiveFilterSchema(type: BuiltinType, optional: boolean, withAggregations: boolean) {
        return match(type)
            .with('String', () => this.makeStringFilterSchema(optional, withAggregations))
            .with(P.union('Int', 'Float', 'Decimal', 'BigInt'), (type) =>
                this.makeNumberFilterSchema(this.makeScalarSchema(type), optional, withAggregations),
            )
            .with('Boolean', () => this.makeBooleanFilterSchema(optional, withAggregations))
            .with('DateTime', () => this.makeDateTimeFilterSchema(optional, withAggregations))
            .with('Bytes', () => this.makeBytesFilterSchema(optional, withAggregations))
            .with('Json', () => this.makeJsonFilterSchema(optional))
            .with('Unsupported', () => z.never())
            .exhaustive();
    }

    private makeJsonValueSchema(nullable: boolean, forFilter: boolean): z.ZodType {
        const options: z.ZodType[] = [z.string(), z.number(), z.boolean(), z.instanceof(JsonNullClass)];

        if (forFilter) {
            options.push(z.instanceof(DbNullClass));
        } else {
            if (nullable) {
                // for mutation, allow DbNull only if nullable
                options.push(z.instanceof(DbNullClass));
            }
        }

        if (forFilter) {
            options.push(z.instanceof(AnyNullClass));
        }

        const schema = z.union([
            ...options,
            z.lazy(() => z.union([this.makeJsonValueSchema(false, false), z.null()]).array()),
            z.record(
                z.string(),
                z.lazy(() => z.union([this.makeJsonValueSchema(false, false), z.null()])),
            ),
        ]);
        return this.nullableIf(schema, nullable);
    }

    private makeJsonFilterSchema(optional: boolean) {
        const valueSchema = this.makeJsonValueSchema(optional, true);
        return z.strictObject({
            path: z.string().optional(),
            equals: valueSchema.optional(),
            not: valueSchema.optional(),
            string_contains: z.string().optional(),
            string_starts_with: z.string().optional(),
            string_ends_with: z.string().optional(),
            mode: this.makeStringModeSchema().optional(),
            array_contains: valueSchema.optional(),
            array_starts_with: valueSchema.optional(),
            array_ends_with: valueSchema.optional(),
        });
    }

    private makeDateTimeFilterSchema(optional: boolean, withAggregations: boolean): ZodType {
        return this.makeCommonPrimitiveFilterSchema(
            z.union([z.iso.datetime(), z.date()]),
            optional,
            () => z.lazy(() => this.makeDateTimeFilterSchema(optional, withAggregations)),
            withAggregations ? ['_count', '_min', '_max'] : undefined,
        );
    }

    private makeBooleanFilterSchema(optional: boolean, withAggregations: boolean): ZodType {
        const components = this.makeCommonPrimitiveFilterComponents(
            z.boolean(),
            optional,
            () => z.lazy(() => this.makeBooleanFilterSchema(optional, withAggregations)),
            ['equals', 'not'],
            withAggregations ? ['_count', '_min', '_max'] : undefined,
        );
        return z.union([this.nullableIf(z.boolean(), optional), z.strictObject(components)]);
    }

    private makeBytesFilterSchema(optional: boolean, withAggregations: boolean): ZodType {
        const baseSchema = z.instanceof(Uint8Array);
        const components = this.makeCommonPrimitiveFilterComponents(
            baseSchema,
            optional,
            () => z.instanceof(Uint8Array),
            ['equals', 'in', 'notIn', 'not'],
            withAggregations ? ['_count', '_min', '_max'] : undefined,
        );
        return z.union([this.nullableIf(baseSchema, optional), z.strictObject(components)]);
    }

    private makeCommonPrimitiveFilterComponents(
        baseSchema: ZodType,
        optional: boolean,
        makeThis: () => ZodType,
        supportedOperators: string[] | undefined = undefined,
        withAggregations: Array<'_count' | '_avg' | '_sum' | '_min' | '_max'> | undefined = undefined,
    ) {
        const commonAggSchema = () =>
            this.makeCommonPrimitiveFilterSchema(baseSchema, false, makeThis, undefined).optional();
        let result = {
            equals: this.nullableIf(baseSchema.optional(), optional),
            notEquals: this.nullableIf(baseSchema.optional(), optional),
            in: baseSchema.array().optional(),
            notIn: baseSchema.array().optional(),
            lt: baseSchema.optional(),
            lte: baseSchema.optional(),
            gt: baseSchema.optional(),
            gte: baseSchema.optional(),
            not: makeThis().optional(),
            ...(withAggregations?.includes('_count')
                ? { _count: this.makeNumberFilterSchema(z.number().int(), false, false).optional() }
                : {}),
            ...(withAggregations?.includes('_avg') ? { _avg: commonAggSchema() } : {}),
            ...(withAggregations?.includes('_sum') ? { _sum: commonAggSchema() } : {}),
            ...(withAggregations?.includes('_min') ? { _min: commonAggSchema() } : {}),
            ...(withAggregations?.includes('_max') ? { _max: commonAggSchema() } : {}),
        };
        if (supportedOperators) {
            const keys = [...supportedOperators, ...(withAggregations ?? [])];
            result = extractFields(result, keys) as typeof result;
        }
        return result;
    }

    private makeCommonPrimitiveFilterSchema(
        baseSchema: ZodType,
        optional: boolean,
        makeThis: () => ZodType,
        withAggregations: Array<AGGREGATE_OPERATORS> | undefined = undefined,
    ): z.ZodType {
        return z.union([
            this.nullableIf(baseSchema, optional),
            z.strictObject(
                this.makeCommonPrimitiveFilterComponents(baseSchema, optional, makeThis, undefined, withAggregations),
            ),
        ]);
    }

    private makeNumberFilterSchema(baseSchema: ZodType, optional: boolean, withAggregations: boolean): ZodType {
        return this.makeCommonPrimitiveFilterSchema(
            baseSchema,
            optional,
            () => z.lazy(() => this.makeNumberFilterSchema(baseSchema, optional, withAggregations)),
            withAggregations ? ['_count', '_avg', '_sum', '_min', '_max'] : undefined,
        );
    }

    private makeStringFilterSchema(optional: boolean, withAggregations: boolean): ZodType {
        return z.union([
            this.nullableIf(z.string(), optional),
            z.strictObject({
                ...this.makeCommonPrimitiveFilterComponents(
                    z.string(),
                    optional,
                    () => z.lazy(() => this.makeStringFilterSchema(optional, withAggregations)),
                    undefined,
                    withAggregations ? ['_count', '_min', '_max'] : undefined,
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
                fields[field] = this.makeRelationSelectIncludeSchema(fieldDef).optional();
            } else {
                fields[field] = z.boolean().optional();
            }
        }

        const _countSchema = this.makeCountSelectionSchema(modelDef);
        if (_countSchema) {
            fields['_count'] = _countSchema;
        }

        return z.strictObject(fields);
    }

    private makeCountSelectionSchema(modelDef: ModelDef) {
        const toManyRelations = Object.values(modelDef.fields).filter((def) => def.relation && def.array);
        if (toManyRelations.length > 0) {
            return z
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
        } else {
            return undefined;
        }
    }

    private makeRelationSelectIncludeSchema(fieldDef: FieldDef) {
        let objSchema: z.ZodType = z.strictObject({
            ...(fieldDef.array || fieldDef.optional
                ? {
                      // to-many relations and optional to-one relations are filterable
                      where: z.lazy(() => this.makeWhereSchema(fieldDef.type, false)).optional(),
                  }
                : {}),
            select: z
                .lazy(() => this.makeSelectSchema(fieldDef.type))
                .optional()
                .nullable(),
            include: z
                .lazy(() => this.makeIncludeSchema(fieldDef.type))
                .optional()
                .nullable(),
            omit: z
                .lazy(() => this.makeOmitSchema(fieldDef.type))
                .optional()
                .nullable(),
            ...(fieldDef.array
                ? {
                      // to-many relations can be ordered, skipped, taken, and cursor-located
                      orderBy: z
                          .lazy(() => this.orArray(this.makeOrderBySchema(fieldDef.type, true, false), true))
                          .optional(),
                      skip: this.makeSkipSchema().optional(),
                      take: this.makeTakeSchema().optional(),
                      cursor: this.makeCursorSchema(fieldDef.type).optional(),
                      distinct: this.makeDistinctSchema(fieldDef.type).optional(),
                  }
                : {}),
        });

        objSchema = this.refineForSelectIncludeMutuallyExclusive(objSchema);
        objSchema = this.refineForSelectOmitMutuallyExclusive(objSchema);

        return z.union([z.boolean(), objSchema]);
    }

    private makeOmitSchema(model: string) {
        const modelDef = requireModel(this.schema, model);
        const fields: Record<string, ZodType> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = requireField(this.schema, model, field);
            if (!fieldDef.relation) {
                if (this.options.allowQueryTimeOmitOverride !== false) {
                    // if override is allowed, use boolean
                    fields[field] = z.boolean().optional();
                } else {
                    // otherwise only allow true
                    fields[field] = z.literal(true).optional();
                }
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
                fields[field] = this.makeRelationSelectIncludeSchema(fieldDef).optional();
            }
        }

        const _countSchema = this.makeCountSelectionSchema(modelDef);
        if (_countSchema) {
            fields['_count'] = _countSchema;
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
        let schema: ZodType = z.strictObject({
            data: dataSchema,
            select: this.makeSelectSchema(model).optional().nullable(),
            include: this.makeIncludeSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
        schema = this.refineForSelectIncludeMutuallyExclusive(schema);
        schema = this.refineForSelectOmitMutuallyExclusive(schema);
        return schema;
    }

    private makeCreateManySchema(model: string) {
        return this.makeCreateManyDataSchema(model, []).optional();
    }

    private makeCreateManyAndReturnSchema(model: string) {
        const base = this.makeCreateManyDataSchema(model, []);
        const result = base.extend({
            select: this.makeSelectSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
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
                let fieldSchema = this.makeScalarSchema(fieldDef.type, fieldDef.attributes);

                if (fieldDef.array) {
                    fieldSchema = addListValidation(fieldSchema.array(), fieldDef.attributes);
                    fieldSchema = z
                        .union([
                            fieldSchema,
                            z.strictObject({
                                set: fieldSchema,
                            }),
                        ])
                        .optional();
                }

                if (fieldDef.optional || fieldHasDefaultValue(fieldDef)) {
                    fieldSchema = fieldSchema.optional();
                }

                if (fieldDef.optional) {
                    if (fieldDef.type === 'Json') {
                        // DbNull for Json fields
                        fieldSchema = z.union([fieldSchema, z.instanceof(DbNullClass)]);
                    } else {
                        fieldSchema = fieldSchema.nullable();
                    }
                }

                uncheckedVariantFields[field] = fieldSchema;
                if (!fieldDef.foreignKeyFor) {
                    // non-fk field
                    checkedVariantFields[field] = fieldSchema;
                }
            }
        });

        const uncheckedCreateSchema = this.extraValidationsEnabled
            ? addCustomValidation(z.strictObject(uncheckedVariantFields), modelDef.attributes)
            : z.strictObject(uncheckedVariantFields);
        const checkedCreateSchema = this.extraValidationsEnabled
            ? addCustomValidation(z.strictObject(checkedVariantFields), modelDef.attributes)
            : z.strictObject(checkedVariantFields);

        if (!hasRelation) {
            return this.orArray(uncheckedCreateSchema, canBeArray);
        } else {
            return z.union([
                uncheckedCreateSchema,
                checkedCreateSchema,
                ...(canBeArray ? [z.array(uncheckedCreateSchema)] : []),
                ...(canBeArray ? [z.array(checkedCreateSchema)] : []),
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
                              where: this.makeWhereSchema(fieldType, false).optional(),
                              data: this.makeUpdateDataSchema(fieldType, withoutFields),
                          }),
                          this.makeUpdateDataSchema(fieldType, withoutFields),
                      ])
                      .optional();

            let upsertWhere = this.makeWhereSchema(fieldType, true);
            if (!fieldDef.array) {
                // to-one relation, can upsert without where clause
                upsertWhere = upsertWhere.optional();
            }
            fields['upsert'] = this.orArray(
                z.strictObject({
                    where: upsertWhere,
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
            z.strictObject({
                where: whereSchema,
                create: createSchema,
            }),
            canBeArray,
        );
    }

    private makeCreateManyDataSchema(model: string, withoutFields: string[]) {
        return z.strictObject({
            data: this.makeCreateDataSchema(model, true, withoutFields, true),
            skipDuplicates: z.boolean().optional(),
        });
    }

    // #endregion

    // #region Update

    private makeUpdateSchema(model: string) {
        let schema: ZodType = z.strictObject({
            where: this.makeWhereSchema(model, true),
            data: this.makeUpdateDataSchema(model),
            select: this.makeSelectSchema(model).optional().nullable(),
            include: this.makeIncludeSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
        schema = this.refineForSelectIncludeMutuallyExclusive(schema);
        schema = this.refineForSelectOmitMutuallyExclusive(schema);
        return schema;
    }

    private makeUpdateManySchema(model: string) {
        return z.strictObject({
            where: this.makeWhereSchema(model, false).optional(),
            data: this.makeUpdateDataSchema(model, [], true),
            limit: z.number().int().nonnegative().optional(),
        });
    }

    private makeUpdateManyAndReturnSchema(model: string) {
        const base = this.makeUpdateManySchema(model);
        let schema: ZodType = base.extend({
            select: this.makeSelectSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
        schema = this.refineForSelectOmitMutuallyExclusive(schema);
        return schema;
    }

    private makeUpsertSchema(model: string) {
        let schema: ZodType = z.strictObject({
            where: this.makeWhereSchema(model, true),
            create: this.makeCreateDataSchema(model, false),
            update: this.makeUpdateDataSchema(model),
            select: this.makeSelectSchema(model).optional().nullable(),
            include: this.makeIncludeSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
        schema = this.refineForSelectIncludeMutuallyExclusive(schema);
        schema = this.refineForSelectOmitMutuallyExclusive(schema);
        return schema;
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
                let fieldSchema = this.makeScalarSchema(fieldDef.type, fieldDef.attributes);

                if (this.isNumericField(fieldDef)) {
                    fieldSchema = z.union([
                        fieldSchema,
                        z
                            .object({
                                set: this.nullableIf(z.number().optional(), !!fieldDef.optional).optional(),
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
                    const arraySchema = addListValidation(fieldSchema.array(), fieldDef.attributes);
                    fieldSchema = z.union([
                        arraySchema,
                        z
                            .object({
                                set: arraySchema.optional(),
                                push: z.union([fieldSchema, fieldSchema.array()]).optional(),
                            })
                            .refine((v) => Object.keys(v).length === 1, 'Only one of "set", "push" can be provided'),
                    ]);
                }

                if (fieldDef.optional) {
                    if (fieldDef.type === 'Json') {
                        // DbNull for Json fields
                        fieldSchema = z.union([fieldSchema, z.instanceof(DbNullClass)]);
                    } else {
                        fieldSchema = fieldSchema.nullable();
                    }
                }

                // all fields are optional in update
                fieldSchema = fieldSchema.optional();

                uncheckedVariantFields[field] = fieldSchema;
                if (!fieldDef.foreignKeyFor) {
                    // non-fk field
                    checkedVariantFields[field] = fieldSchema;
                }
            }
        });

        const uncheckedUpdateSchema = this.extraValidationsEnabled
            ? addCustomValidation(z.strictObject(uncheckedVariantFields), modelDef.attributes)
            : z.strictObject(uncheckedVariantFields);
        const checkedUpdateSchema = this.extraValidationsEnabled
            ? addCustomValidation(z.strictObject(checkedVariantFields), modelDef.attributes)
            : z.strictObject(checkedVariantFields);
        if (!hasRelation) {
            return uncheckedUpdateSchema;
        } else {
            return z.union([uncheckedUpdateSchema, checkedUpdateSchema]);
        }
    }

    // #endregion

    // #region Delete

    private makeDeleteSchema(model: GetModels<Schema>) {
        let schema: ZodType = z.strictObject({
            where: this.makeWhereSchema(model, true),
            select: this.makeSelectSchema(model).optional().nullable(),
            include: this.makeIncludeSchema(model).optional().nullable(),
            omit: this.makeOmitSchema(model).optional().nullable(),
        });
        schema = this.refineForSelectIncludeMutuallyExclusive(schema);
        schema = this.refineForSelectOmitMutuallyExclusive(schema);
        return schema;
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
            z.strictObject({
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
        const bySchema =
            nonRelationFields.length > 0
                ? this.orArray(z.enum(nonRelationFields as [string, ...string[]]), true)
                : z.never();

        let schema: z.ZodSchema = z.strictObject({
            where: this.makeWhereSchema(model, false).optional(),
            orderBy: this.orArray(this.makeOrderBySchema(model, false, true), true).optional(),
            by: bySchema,
            having: this.makeHavingSchema(model).optional(),
            skip: this.makeSkipSchema().optional(),
            take: this.makeTakeSchema().optional(),
            _count: this.makeCountAggregateInputSchema(model).optional(),
            _avg: this.makeSumAvgInputSchema(model).optional(),
            _sum: this.makeSumAvgInputSchema(model).optional(),
            _min: this.makeMinMaxInputSchema(model).optional(),
            _max: this.makeMinMaxInputSchema(model).optional(),
        });

        // fields used in `having` must be either in the `by` list, or aggregations
        schema = schema.refine((value: any) => {
            const bys = typeof value.by === 'string' ? [value.by] : value.by;
            if (value.having && typeof value.having === 'object') {
                for (const [key, val] of Object.entries(value.having)) {
                    if (AGGREGATE_OPERATORS.includes(key as any)) {
                        continue;
                    }
                    if (bys.includes(key)) {
                        continue;
                    }
                    // we have a key not mentioned in `by`, in this case it must only use
                    // aggregations in the condition

                    // 1. payload must be an object
                    if (!val || typeof val !== 'object') {
                        return false;
                    }
                    // 2. payload must only contain aggregations
                    if (!this.onlyAggregationFields(val)) {
                        return false;
                    }
                }
            }
            return true;
        }, 'fields in "having" must be in "by"');

        // fields used in `orderBy` must be either in the `by` list, or aggregations
        schema = schema.refine((value: any) => {
            const bys = typeof value.by === 'string' ? [value.by] : value.by;
            if (
                value.orderBy &&
                Object.keys(value.orderBy)
                    .filter((f) => !AGGREGATE_OPERATORS.includes(f as AGGREGATE_OPERATORS))
                    .some((key) => !bys.includes(key))
            ) {
                return false;
            } else {
                return true;
            }
        }, 'fields in "orderBy" must be in "by"');

        return schema;
    }

    private onlyAggregationFields(val: object) {
        for (const [key, value] of Object.entries(val)) {
            if (AGGREGATE_OPERATORS.includes(key as any)) {
                // aggregation field
                continue;
            }
            if (LOGICAL_COMBINATORS.includes(key as any)) {
                // logical operators
                if (enumerate(value).every((v) => this.onlyAggregationFields(v))) {
                    continue;
                }
            }
            return false;
        }
        return true;
    }

    private makeHavingSchema(model: GetModels<Schema>) {
        return this.makeWhereSchema(model, false, true, true);
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
