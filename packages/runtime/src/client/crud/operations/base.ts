import { match } from 'ts-pattern';
import { z, type ZodSchema } from 'zod';
import type { GetModels, SchemaDef } from '../../../schema';
import { InternalError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import {
    getField,
    getIdFields,
    getModel,
    getUniqueFields,
    requireField,
    requireModel,
} from '../../query-utils';
import type { CrudOperation } from '../crud-handler';
import { orArray } from './common';

export abstract class BaseOperationHandler<Schema extends SchemaDef> {
    constructor(
        protected readonly schema: Schema,
        protected readonly kysely: ToKysely<Schema>,
        protected readonly model: GetModels<Schema>,
        protected readonly options: ClientOptions<Schema>
    ) {}

    abstract handle(operation: CrudOperation, args: any): Promise<unknown>;

    protected requireModel(model: string) {
        return requireModel(this.schema, model);
    }

    protected getModel(model: string) {
        return getModel(this.schema, model);
    }

    protected requireField(model: string, field: string) {
        return requireField(this.schema, model, field);
    }

    protected getField(model: string, field: string) {
        return getField(this.schema, model, field);
    }

    protected makeWhereSchema(model: string, unique: boolean): ZodSchema {
        const modelDef = this.getModel(model);
        if (!modelDef) {
            throw new QueryError(`Model "${model}" not found`);
        }
        const fields: Record<string, any> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = this.getField(model, field);
            if (!fieldDef) {
                throw new QueryError(
                    `Field "${field}" not found in model "${model}"`
                );
            }
            if (fieldDef.relation) {
                fields[field] = z.lazy(() =>
                    this.makeWhereSchema(fieldDef.type, false).optional()
                );
            } else {
                fields[field] = this.makePrimitiveSchema(
                    fieldDef.type
                ).optional();
            }
        }

        // expression builder
        fields['$expr'] = z.function().optional();

        // logical operators
        fields['AND'] = orArray(
            z.lazy(() => this.makeWhereSchema(model, false)),
            true
        ).optional();
        fields['OR'] = z
            .lazy(() => this.makeWhereSchema(model, false))
            .array()
            .optional();
        fields['NOT'] = orArray(
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

    protected makeSelectSchema(model: string) {
        const modelDef = this.requireModel(model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = this.requireField(model, field);
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
        const modelDef = this.requireModel(model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = this.requireField(model, field);
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
        const modelDef = this.requireModel(model);
        const fields: Record<string, ZodSchema> = {};
        for (const field of Object.keys(modelDef.fields)) {
            const fieldDef = this.requireField(model, field);
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

    protected makeFindSchema(
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
            fields['orderBy'] = orArray(
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

    protected makePrimitiveSchema(type: string) {
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

    protected exists(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        filter: any
    ): Promise<Partial<Record<string, any>> | undefined> {
        const modelDef = this.requireModel(model);
        const idFields = getIdFields(this.schema, model);
        return kysely
            .selectFrom(modelDef.dbTable)
            .where((eb) => eb.and(filter))
            .select(idFields.map((f) => kysely.dynamic.ref(f)))
            .limit(1)
            .executeTakeFirst();
    }
}
