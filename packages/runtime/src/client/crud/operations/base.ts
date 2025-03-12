import { createId } from '@paralleldrive/cuid2';
import { sql, type SelectQueryBuilder } from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import * as uuid from 'uuid';
import type { GetModels, ModelDef, SchemaDef } from '../../../schema';
import type {
    BuiltinType,
    FieldDef,
    FieldGenerator,
} from '../../../schema/schema';
import { clone } from '../../../utils/clone';
import { enumerate } from '../../../utils/enumerate';
import type { FindArgs } from '../../client-types';
import { InternalError, NotFoundError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import {
    buildFieldRef,
    getField,
    getIdFields,
    getModel,
    getRelationForeignKeyFieldPairs,
    isForeignKeyField,
    isRelationField,
    isScalarField,
    requireField,
    requireModel,
} from '../../query-utils';
import type { CrudOperation } from '../crud-handler';
import { getCrudDialect } from '../dialects';
import type { BaseCrudDialect } from '../dialects/base';

export type FromRelationContext = {
    model: string;
    field: string;
    ids: any;
};

export abstract class BaseOperationHandler<Schema extends SchemaDef> {
    protected readonly dialect: BaseCrudDialect<Schema>;

    constructor(
        protected readonly schema: Schema,
        protected readonly kysely: ToKysely<Schema>,
        protected readonly model: GetModels<Schema>,
        protected readonly options: ClientOptions<Schema>
    ) {
        this.dialect = getCrudDialect(this.schema, this.options);
    }

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

    protected async read(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true> | undefined
    ): Promise<any[]> {
        const modelDef = this.requireModel(model);

        // table
        let query = kysely.selectFrom(`${modelDef.dbTable}` as any);

        // where
        if (args?.where) {
            query = query.where((eb) =>
                this.dialect.buildFilter(
                    eb,
                    model,
                    modelDef.dbTable,
                    args.where
                )
            );
        }

        // skip && take
        query = this.dialect.buildSkipTake(query, args?.skip, args?.take);

        // orderBy
        if (args?.orderBy) {
            query = this.dialect.buildOrderBy(
                query,
                model,
                modelDef.dbTable,
                args.orderBy
            );
        }

        // select
        if (args?.select) {
            query = this.buildFieldSelection(
                model,
                query,
                args?.select,
                modelDef.dbTable
            );
        } else {
            query = this.buildSelectAllScalarFields(model, query);
        }

        // include
        if (args?.include) {
            query = this.buildFieldSelection(
                model,
                query,
                args?.include,
                modelDef.dbTable
            );
        }

        try {
            return await query.execute();
        } catch (err) {
            const { sql, parameters } = query.compile();
            throw new QueryError(
                `Failed to execute query: ${err}, sql: ${sql}, parameters: ${parameters}`
            );
        }
    }

    protected async readUnique(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true>
    ) {
        const result = await this.read(kysely, model, { ...args, take: 1 });
        return result[0] ?? null;
    }

    private buildFieldSelection(
        model: string,
        query: SelectQueryBuilder<any, any, {}>,
        selectOrInclude: Record<string, any>,
        parentAlias: string
    ) {
        let result = query;

        for (const [field, payload] of Object.entries(selectOrInclude)) {
            if (!payload) {
                continue;
            }
            const fieldDef = this.requireField(model, field);
            if (!fieldDef.relation) {
                result = this.selectField(result, model, parentAlias, field);
            } else {
                if (!fieldDef.array && !fieldDef.optional && payload.where) {
                    throw new QueryError(
                        `Field "${field}" doesn't support filtering`
                    );
                }
                result = this.dialect.buildRelationSelection(
                    result,
                    model,
                    field,
                    parentAlias,
                    payload
                );
            }
        }

        return result;
    }

    private buildSelectAllScalarFields(
        model: string,
        query: SelectQueryBuilder<any, any, {}>
    ) {
        let result = query;
        const modelDef = this.requireModel(model);
        return Object.keys(modelDef.fields)
            .filter((f) => !isRelationField(this.schema, model, f))
            .reduce(
                (acc, f) => this.selectField(acc, model, modelDef.dbTable, f),
                result
            );
    }

    private selectField(
        query: SelectQueryBuilder<any, any, {}>,
        model: string,
        table: string,
        field: string
    ) {
        const fieldDef = this.requireField(model, field);
        if (!fieldDef.computed) {
            return query.select(sql.ref(`${table}.${field}`).as(field));
        } else {
            return query.select((eb) =>
                buildFieldRef(this.schema, model, field, this.options, eb).as(
                    field
                )
            );
        }
    }

    protected async create(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation?: FromRelationContext
    ): Promise<unknown> {
        if (!data || typeof data !== 'object') {
            throw new InternalError('data must be an object');
        }

        const modelDef = this.requireModel(model);
        const nonRelationFields: any = {};
        const relationFields: any = {};

        for (const [field, value] of Object.entries(data)) {
            const fieldDef = this.requireField(model, field);
            if (fieldDef.relation) {
                relationFields[field] = value;
            } else {
                nonRelationFields[field] = value;
            }
        }

        const createData = this.fillGeneratedValues(
            modelDef,
            nonRelationFields
        );

        let postCreateTask:
            | ((createdEntity: any) => Promise<unknown>)
            | undefined;
        if (fromRelation) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field
            );

            if (!ownedByModel) {
                for (const { fk, pk } of keyPairs) {
                    createData[fk] = fromRelation.ids[pk];
                }
            } else {
                postCreateTask = async (createdEntity) => {
                    const updateData = keyPairs.reduce(
                        (acc, { fk, pk }) => ({
                            ...acc,
                            [fk]: createdEntity[pk],
                        }),
                        {} as any
                    );

                    const fromRelationModelDef = this.requireModel(
                        fromRelation.model
                    );
                    return kysely
                        .updateTable(fromRelationModelDef.dbTable)
                        .where((eb) => eb.and(fromRelation.ids))
                        .set(updateData)
                        .execute();
                };
            }
        }

        // create
        const result = await kysely
            .insertInto(modelDef.dbTable)
            .values(createData)
            .returningAll()
            .execute();

        if (postCreateTask) {
            await postCreateTask(result[0]);
        }

        return result[0];
    }

    protected async createMany(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        input: { data: any; skipDuplicates: boolean },
        fromRelation?: FromRelationContext
    ): Promise<unknown> {
        const modelDef = this.requireModel(model);

        let relationKeyPairs: { fk: string; pk: string }[] = [];
        if (fromRelation) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field
            );
            if (ownedByModel) {
                throw new QueryError(
                    'incorrect relation hierarchy for createMany'
                );
            }
            relationKeyPairs = keyPairs;
        }

        const createData = enumerate(input.data).map((item) => {
            if (fromRelation) {
                item = { ...item };
                for (const { fk, pk } of relationKeyPairs) {
                    item[fk] = fromRelation.ids[pk];
                }
            }
            return this.fillGeneratedValues(modelDef, item);
        });

        return kysely
            .insertInto(modelDef.dbTable)
            .values(createData)
            .$if(input.skipDuplicates, (qb) =>
                qb.onConflict((oc) => oc.doNothing())
            )
            .execute();
    }

    private fillGeneratedValues(modelDef: ModelDef, data: object) {
        const fields = modelDef.fields;
        const values: any = clone(data);
        for (const field in fields) {
            if (!(field in data)) {
                if (fields[field]?.generator !== undefined) {
                    const generated = this.evalGenerator(
                        fields[field].generator
                    );
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

    private evalGenerator(generator: FieldGenerator) {
        return match(generator)
            .with('cuid', 'cuid2', () => createId())
            .with('uuid4', () => uuid.v4())
            .with('uuid7', () => uuid.v7())
            .with('nanoid', () => uuid.v7())
            .otherwise(() => undefined);
    }

    protected async update(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        data: any,
        fromRelation?: FromRelationContext,
        allowRelationUpdate = true,
        throwIfNotFound = true
    ) {
        if (!data || typeof data !== 'object') {
            throw new InternalError('data must be an object');
        }

        const mergedWhere = clone(where);
        if (fromRelation) {
            // merge foreign key conditions from the relation
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field
            );
            if (!ownedByModel) {
                for (const { fk, pk } of keyPairs) {
                    mergedWhere[fk] = fromRelation.ids[pk];
                }
            }
        }

        if (Object.keys(data).length === 0) {
            // update without data, simply return
            const r = await this.readUnique(kysely, model, {
                where: mergedWhere,
            });
            if (!r && throwIfNotFound) {
                throw new NotFoundError(model);
            }
            return r;
        }

        const modelDef = this.requireModel(model);

        const updateFields: any = {};
        let thisEntity: any = undefined;

        for (const field in data) {
            const fieldDef = this.requireField(model, field);
            if (
                isScalarField(this.schema, model, field) ||
                isForeignKeyField(this.schema, model, field)
            ) {
                updateFields[field] = this.dialect.transformPrimitive(
                    data[field],
                    fieldDef.type as BuiltinType
                );
            } else {
                if (!allowRelationUpdate) {
                    throw new QueryError(
                        `Relation update not allowed for field "${field}"`
                    );
                }
                if (!thisEntity) {
                    thisEntity = await this.readUnique(kysely, model, {
                        where: mergedWhere,
                        select: this.makeIdSelect(model),
                    });
                    if (!thisEntity) {
                        if (throwIfNotFound) {
                            throw new NotFoundError(model);
                        } else {
                            return null;
                        }
                    }
                }
                await this.processRelationUpdates(
                    kysely,
                    model,
                    field,
                    fieldDef,
                    thisEntity,
                    data[field],
                    throwIfNotFound
                );
            }
        }

        if (Object.keys(updateFields).length === 0) {
            // nothing to update, simply read back
            return (
                thisEntity ??
                (await this.readUnique(kysely, model, { where: mergedWhere }))
            );
        } else {
            const query = kysely
                .updateTable(modelDef.dbTable)
                .where((eb) =>
                    this.dialect.buildFilter(
                        eb,
                        model,
                        modelDef.dbTable,
                        mergedWhere
                    )
                )
                .set(updateFields)
                .returningAll();

            let updatedEntity: any;

            try {
                updatedEntity = await query.execute();
            } catch (err) {
                const { sql, parameters } = query.compile();
                throw new QueryError(
                    `Error during update: ${err}, sql: ${sql}, parameters: ${parameters}`
                );
            }

            if (updatedEntity.length === 0) {
                if (throwIfNotFound) {
                    throw new NotFoundError(model);
                } else {
                    return null;
                }
            }

            return updatedEntity[0];
        }
    }

    private async processRelationUpdates(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        field: string,
        fieldDef: FieldDef,
        parentIds: any,
        args: any,
        throwIfNotFound: boolean
    ) {
        const tasks: Promise<unknown>[] = [];
        const fieldModel = fieldDef.type as GetModels<Schema>;
        const fromRelationContext = {
            model,
            field,
            ids: parentIds,
        };

        for (const [key, value] of Object.entries(args)) {
            switch (key) {
                case 'create': {
                    invariant(
                        !Array.isArray(value) || fieldDef.array,
                        'relation must be an array if create is an array'
                    );
                    tasks.push(
                        ...enumerate(value).map((item) =>
                            this.create(
                                kysely,
                                fieldModel,
                                item,
                                fromRelationContext
                            )
                        )
                    );
                    break;
                }

                case 'createMany': {
                    invariant(
                        fieldDef.array,
                        'relation must be an array for createMany'
                    );
                    tasks.push(
                        this.createMany(
                            kysely,
                            fieldModel,
                            value as { data: any; skipDuplicates: boolean },
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'connect': {
                    tasks.push(
                        this.connectRelation(
                            kysely,
                            fieldModel,
                            enumerate(value),
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'connectOrCreate': {
                    tasks.push(
                        this.connectOrCreateRelation(
                            kysely,
                            fieldModel,
                            enumerate(value) as Array<{
                                where: any;
                                create: any;
                            }>,
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'disconnect': {
                    tasks.push(
                        this.disconnectRelation(
                            kysely,
                            fieldModel,
                            enumerate(value),
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'set': {
                    invariant(fieldDef.array, 'relation must be an array');
                    tasks.push(
                        this.setRelation(
                            kysely,
                            fieldModel,
                            enumerate(value),
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'update': {
                    tasks.push(
                        ...(
                            enumerate(value) as { where: any; data: any }[]
                        ).map((item) =>
                            this.update(
                                kysely,
                                fieldModel,
                                item.where,
                                item.data,
                                fromRelationContext,
                                true,
                                throwIfNotFound
                            )
                        )
                    );
                    break;
                }

                case 'updateMany': {
                    tasks.push(
                        ...(
                            enumerate(value) as { where: any; data: any }[]
                        ).map((item) =>
                            this.update(
                                kysely,
                                fieldModel,
                                item.where,
                                item.data,
                                fromRelationContext,
                                false,
                                false
                            )
                        )
                    );
                    break;
                }

                case 'delete': {
                    tasks.push(
                        this.deleteRelation(
                            kysely,
                            fieldModel,
                            enumerate(value),
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'deleteMany': {
                    tasks.push(
                        this.deleteRelation(
                            kysely,
                            fieldModel,
                            enumerate(value),
                            fromRelationContext
                        )
                    );
                    break;
                }

                default: {
                    throw new Error('Not implemented yet');
                }
            }
        }

        await Promise.all(tasks);
    }

    protected async connectRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any[],
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        if (data.length === 0) {
            return;
        }

        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        // TODO: handle to-one relations
        if (ownedByModel) {
            throw new InternalError(
                'relation can only be set from the non-owning side'
            );
        }

        // connect
        await kysely
            .updateTable(modelDef.dbTable)
            .where((eb) => eb.or(data.map((d) => eb.and(d))))
            .set(
                keyPairs.reduce(
                    (acc, { fk, pk }) => ({
                        ...acc,
                        [fk]: fromRelation.ids[pk],
                    }),
                    {} as any
                )
            )
            .execute();
    }

    protected async connectOrCreateRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: Array<{ where: any; create: any }>,
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        if (data.length === 0) {
            return;
        }

        const { ownedByModel } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        // TODO: handle to-one relations
        if (ownedByModel) {
            throw new InternalError(
                'relation can only be set from the non-owning side'
            );
        }

        return Promise.all(
            data.map(async ({ where, create }) => {
                const existing = await this.exists(kysely, model, where);
                if (existing) {
                    return this.connectRelation(
                        kysely,
                        model,
                        [where],
                        fromRelation
                    );
                } else {
                    return this.create(kysely, model, create, fromRelation);
                }
            })
        );
    }

    protected async disconnectRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any[],
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        if (data.length === 0) {
            return;
        }

        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        if (ownedByModel) {
            throw new InternalError(
                'relation can only be set from the non-owning side'
            );
        }

        // disconnect
        await kysely
            .updateTable(modelDef.dbTable)
            .where((eb) => eb.or(data.map((d) => eb.and(d))))
            .set(
                keyPairs.reduce(
                    (acc, { fk }) => ({ ...acc, [fk]: null }),
                    {} as any
                )
            )
            .execute();
    }

    protected async setRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any[],
        fromRelation: FromRelationContext
    ) {
        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        if (ownedByModel) {
            throw new InternalError(
                'relation can only be set from the non-owning side'
            );
        }

        const fkConditions = keyPairs.reduce(
            (acc, { fk, pk }) => ({
                ...acc,
                [fk]: fromRelation.ids[pk],
            }),
            {} as any
        );

        // disconnect
        await kysely
            .updateTable(modelDef.dbTable)
            .where((eb) =>
                eb.and([
                    // match parent
                    eb.and(fkConditions),
                    // exclude entities to be connected
                    eb.not(eb.or(data.map((d) => eb.and(d)))),
                ])
            )
            .set(
                keyPairs.reduce(
                    (acc, { fk }) => ({ ...acc, [fk]: null }),
                    {} as any
                )
            )
            .execute();

        // connect
        if (data.length > 0) {
            await kysely
                .updateTable(modelDef.dbTable)
                .where((eb) => eb.or(data.map((d) => eb.and(d))))
                .set(
                    keyPairs.reduce(
                        (acc, { fk, pk }) => ({
                            ...acc,
                            [fk]: fromRelation.ids[pk],
                        }),
                        {} as any
                    )
                )
                .execute();
        }
    }

    protected async deleteRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any[],
        fromRelation: FromRelationContext
    ) {
        if (data.length === 0) {
            return;
        }

        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        if (ownedByModel) {
            throw new InternalError(
                'relation can only be deleted from the non-owning side'
            );
        }

        return kysely
            .deleteFrom(modelDef.dbTable)
            .where((eb) =>
                eb.and([
                    eb.and(
                        keyPairs.map(({ fk, pk }) =>
                            eb(sql.ref(fk), '=', fromRelation.ids[pk])
                        )
                    ),
                    eb.or(data.map((d) => eb.and(d))),
                ])
            )
            .execute();
    }

    protected makeIdSelect(model: string) {
        const modelDef = this.requireModel(model);
        return modelDef.idFields.reduce((acc, f) => {
            acc[f] = true;
            return acc;
        }, {} as any);
    }
}
