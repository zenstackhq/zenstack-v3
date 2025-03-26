import { createId } from '@paralleldrive/cuid2';
import {
    DeleteResult,
    sql,
    UpdateResult,
    type SelectQueryBuilder,
} from 'kysely';
import { nanoid } from 'nanoid';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { ulid } from 'ulid';
import * as uuid from 'uuid';
import type { GetModels, ModelDef, SchemaDef } from '../../../schema';
import type {
    BuiltinType,
    FieldDef,
    FieldDefaultProvider,
} from '../../../schema/schema';
import { clone } from '../../../utils/clone';
import { enumerate } from '../../../utils/enumerate';
import type { FindArgs, SelectInclude, Where } from '../../client-types';
import { InternalError, NotFoundError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import {
    buildFieldRef,
    getField,
    getIdFields,
    getIdValues,
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
        const modelDef = this.requireModel(model);
        const createFields: any = {};
        let parentUpdateTask: ((entity: any) => Promise<unknown>) | undefined =
            undefined;

        if (fromRelation) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation?.model ?? '',
                fromRelation?.field ?? ''
            );

            if (!ownedByModel) {
                // assign fks from parent
                const parentFkFields = this.buildFkAssignments(
                    fromRelation.model,
                    fromRelation.field,
                    fromRelation.ids
                );
                Object.assign(createFields, parentFkFields);
            } else {
                const fromRelationModelDef = this.requireModel(
                    fromRelation.model
                );
                parentUpdateTask = (entity) => {
                    return kysely
                        .updateTable(fromRelationModelDef.dbTable)
                        .set(
                            keyPairs.reduce(
                                (acc, { fk, pk }) => ({
                                    ...acc,
                                    [fk]: entity[pk],
                                }),
                                {} as any
                            )
                        )
                        .where((eb) => eb.and(fromRelation.ids))
                        .execute();
                };
            }
        }

        // process the create and handle relations
        const postCreateRelations: Record<string, object> = {};
        for (const [field, value] of Object.entries(data)) {
            const fieldDef = this.requireField(model, field);
            if (
                isScalarField(this.schema, model, field) ||
                isForeignKeyField(this.schema, model, field)
            ) {
                createFields[field] = this.dialect.transformPrimitive(
                    value,
                    fieldDef.type as BuiltinType
                );
            } else {
                if (
                    fieldDef.relation?.fields &&
                    fieldDef.relation?.references
                ) {
                    const fkValues = await this.processOwnedRelation(
                        kysely,
                        fieldDef,
                        value
                    );
                    for (let i = 0; i < fieldDef.relation.fields.length; i++) {
                        createFields[fieldDef.relation.fields[i]!] =
                            fkValues[fieldDef.relation.references[i]!];
                    }
                } else {
                    const subPayload = value;
                    if (subPayload && typeof subPayload === 'object') {
                        postCreateRelations[field] = subPayload;
                    }
                }
            }
        }

        const updatedData = this.fillGeneratedValues(modelDef, createFields);
        const query = kysely
            .insertInto(modelDef.dbTable)
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

        if (Object.keys(postCreateRelations).length > 0) {
            // process nested creates that need to happen after the current entity is created
            const relationPromises = Object.entries(postCreateRelations).map(
                ([field, subPayload]) => {
                    return this.processNoneOwnedRelation(
                        kysely,
                        model,
                        field,
                        subPayload,
                        createdEntity
                    );
                }
            );

            // await relation creation
            await Promise.all(relationPromises);
        }

        // finally update parent if needed
        if (parentUpdateTask) {
            await parentUpdateTask(createdEntity);
        }

        return createdEntity;
    }

    private buildFkAssignments(
        model: string,
        relationField: string,
        entity: any
    ) {
        const parentFkFields: any = {};

        invariant(
            relationField,
            'parentField must be defined if parentModel is defined'
        );
        invariant(
            entity,
            'parentEntity must be defined if parentModel is defined'
        );

        const { keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
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

    private async processOwnedRelation(
        kysely: ToKysely<Schema>,
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
                    const created = await this.create(
                        kysely,
                        relationModel,
                        subPayload
                    );
                    // extract id fields and return as foreign key values
                    result = getIdValues(
                        this.schema,
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
                    const found = await this.exists(
                        kysely,
                        relationModel,
                        subPayload.where
                    );
                    if (!found) {
                        // create
                        const created = await this.create(
                            kysely,
                            relationModel,
                            subPayload.create
                        );
                        result = getIdValues(
                            this.schema,
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

    private processNoneOwnedRelation(
        kysely: ToKysely<Schema>,
        contextModel: string,
        relationFieldName: string,
        payload: any,
        parentEntity: any
    ) {
        const relationFieldDef = this.requireField(
            contextModel,
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
                        ...enumerate(subPayload).map((item) =>
                            this.create(kysely, relationModel, item, {
                                model: contextModel,
                                field: relationFieldName,
                                ids: parentEntity,
                            })
                        )
                    );
                    break;
                }

                case 'connect': {
                    tasks.push(
                        this.connectRelation(
                            kysely,
                            relationModel,
                            subPayload,
                            {
                                model: contextModel,
                                field: relationFieldName,
                                ids: parentEntity,
                            }
                        )
                    );
                    break;
                }

                case 'connectOrCreate': {
                    tasks.push(
                        ...enumerate(subPayload).map((item) =>
                            this.exists(kysely, relationModel, item.where).then(
                                (found) =>
                                    !found
                                        ? this.create(
                                              kysely,
                                              relationModel,
                                              item.create,
                                              {
                                                  model: contextModel,
                                                  field: relationFieldName,
                                                  ids: parentEntity,
                                              }
                                          )
                                        : this.connectRelation(
                                              kysely,
                                              relationModel,
                                              found,
                                              {
                                                  model: contextModel,
                                                  field: relationFieldName,
                                                  ids: parentEntity,
                                              }
                                          )
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

    protected async createMany(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        input: { data: any; skipDuplicates?: boolean },
        fromRelation?: FromRelationContext
    ) {
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

        const result = await kysely
            .insertInto(modelDef.dbTable)
            .values(createData)
            .$if(!!input.skipDuplicates, (qb) =>
                qb.onConflict((oc) => oc.doNothing())
            )
            .execute();
        return { count: Number(result[0]!.numInsertedOrUpdatedRows!) };
    }

    private fillGeneratedValues(modelDef: ModelDef, data: object) {
        const fields = modelDef.fields;
        const values: any = clone(data);
        for (const field in fields) {
            if (!(field in data)) {
                if (
                    typeof fields[field]?.default === 'object' &&
                    'call' in fields[field].default
                ) {
                    const generated = this.evalGenerator(fields[field].default);
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

    private evalGenerator(defaultProvider: FieldDefaultProvider) {
        return match(defaultProvider.call)
            .with('cuid', () => createId())
            .with('uuid', () =>
                defaultProvider.args?.[0] === 7 ? uuid.v7() : uuid.v4()
            )
            .with('nanoid', () => nanoid(defaultProvider.args?.[0]))
            .with('ulid', () => ulid())
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

        const parentWhere: any = {};
        if (fromRelation) {
            // merge foreign key conditions from the relation
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field
            );
            if (ownedByModel) {
                const fromEntity = await this.readUnique(
                    kysely,
                    fromRelation.model as GetModels<Schema>,
                    {
                        where: fromRelation.ids,
                    }
                );
                for (const { fk, pk } of keyPairs) {
                    parentWhere[pk] = fromEntity[fk];
                }
            } else {
                for (const { fk, pk } of keyPairs) {
                    parentWhere[fk] = fromRelation.ids[pk];
                }
            }
        }

        let combinedWhere: Where<Schema, GetModels<Schema>, false> = where ??
        {};
        if (Object.keys(parentWhere).length > 0) {
            combinedWhere =
                Object.keys(combinedWhere).length > 0
                    ? { AND: [parentWhere, combinedWhere] }
                    : parentWhere;
        }

        if (Object.keys(data).length === 0) {
            // update without data, simply return
            const r = await this.readUnique(kysely, model, {
                where: combinedWhere,
            } as FindArgs<Schema, GetModels<Schema>, true>);
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
                        where: combinedWhere,
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
                (await this.readUnique(kysely, model, { where: combinedWhere }))
            );
        } else {
            const query = kysely
                .updateTable(modelDef.dbTable)
                .where((eb) =>
                    this.dialect.buildFilter(
                        eb,
                        model,
                        modelDef.dbTable,
                        combinedWhere
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

    protected async updateMany(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        data: any,
        limit?: number
    ) {
        if (typeof data !== 'object') {
            throw new InternalError('data must be an object');
        }

        if (Object.keys(data).length === 0) {
            return { count: 0 };
        }

        const modelDef = this.requireModel(model);
        const updateFields: any = {};

        for (const field in data) {
            const fieldDef = this.requireField(model, field);
            if (isRelationField(this.schema, model, field)) {
                continue;
            }
            updateFields[field] = this.dialect.transformPrimitive(
                data[field],
                fieldDef.type as BuiltinType
            );
        }

        let query = kysely.updateTable(modelDef.dbTable).set(updateFields);

        if (limit === undefined) {
            query = query.where((eb) =>
                this.dialect.buildFilter(eb, model, modelDef.dbTable, where)
            );
        } else {
            if (this.dialect.supportsUpdateWithLimit) {
                query = query
                    .where((eb) =>
                        this.dialect.buildFilter(
                            eb,
                            model,
                            modelDef.dbTable,
                            where
                        )
                    )
                    .limit(limit!);
            } else {
                query = query.where((eb) =>
                    eb(
                        eb.refTuple(
                            // @ts-expect-error
                            ...this.buildIdFieldRefs(kysely, model)
                        ),
                        'in',
                        kysely
                            .selectFrom(modelDef.dbTable)
                            .where((eb) =>
                                this.dialect.buildFilter(
                                    eb,
                                    model,
                                    modelDef.dbTable,
                                    where
                                )
                            )
                            .select(this.buildIdFieldRefs(kysely, model))
                            .limit(limit!)
                    )
                );
            }
        }

        try {
            const result = await query.execute();
            return { count: Number(result[0]?.numUpdatedRows!) };
        } catch (err) {
            const { sql, parameters } = query.compile();
            throw new QueryError(
                `Error during updateMany: ${err}, sql: ${sql}, parameters: ${parameters}`
            );
        }
    }

    private buildIdFieldRefs(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>
    ) {
        const idFields = getIdFields(this.schema, model);
        return idFields.map((f) => kysely.dynamic.ref(f));
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
                            value,
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
                            value,
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
                            value,
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
                            value,
                            fromRelationContext
                        )
                    );
                    break;
                }

                case 'update': {
                    tasks.push(
                        ...(
                            enumerate(value) as { where: any; data: any }[]
                        ).map((item) => {
                            let where;
                            let data;
                            if ('where' in item) {
                                where = item.where;
                                data = item.data;
                            } else {
                                where = undefined;
                                data = item;
                            }
                            return this.update(
                                kysely,
                                fieldModel,
                                where,
                                data,
                                fromRelationContext,
                                true,
                                throwIfNotFound
                            );
                        })
                    );
                    break;
                }

                case 'upsert': {
                    tasks.push(
                        ...(
                            enumerate(value) as {
                                where: any;
                                create: any;
                                update: any;
                            }[]
                        ).map(async (item) => {
                            const updated = await this.update(
                                kysely,
                                fieldModel,
                                item.where,
                                item.update,
                                fromRelationContext,
                                true,
                                false
                            );
                            if (updated) {
                                return updated;
                            } else {
                                return this.create(
                                    kysely,
                                    fieldModel,
                                    item.create,
                                    fromRelationContext
                                );
                            }
                        })
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
                            value,
                            fromRelationContext,
                            true
                        )
                    );
                    break;
                }

                case 'deleteMany': {
                    tasks.push(
                        this.deleteRelation(
                            kysely,
                            fieldModel,
                            value,
                            fromRelationContext,
                            false
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
        data: any,
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        const _data = enumerate(data);
        if (_data.length === 0) {
            return;
        }

        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );
        let updateResult: UpdateResult[];

        if (ownedByModel) {
            // set parent fk directly
            invariant(_data.length === 1, 'only one entity can be connected');
            const target = await this.readUnique(kysely, model, {
                where: _data[0],
            });
            if (!target) {
                throw new NotFoundError(model);
            }
            const fromRelationModelDef = this.requireModel(fromRelation.model);
            updateResult = await kysely
                .updateTable(fromRelationModelDef.dbTable)
                .where((eb) => eb.and(fromRelation.ids))
                .set(
                    keyPairs.reduce(
                        (acc, { fk, pk }) => ({
                            ...acc,
                            [fk]: target[pk],
                        }),
                        {} as any
                    )
                )
                .execute();
        } else {
            const modelDef = this.requireModel(model);

            // disconnect current if it's a one-one relation
            const relationFieldDef = this.requireField(
                fromRelation.model,
                fromRelation.field
            );

            if (!relationFieldDef.array) {
                await kysely
                    .updateTable(modelDef.dbTable)
                    .where((eb) =>
                        eb.and(
                            keyPairs.map(({ fk, pk }) =>
                                eb(sql.ref(fk), '=', fromRelation.ids[pk])
                            )
                        )
                    )
                    .set(
                        keyPairs.reduce(
                            (acc, { fk }) => ({ ...acc, [fk]: null }),
                            {} as any
                        )
                    )
                    .execute();
            }

            // connect
            updateResult = await kysely
                .updateTable(modelDef.dbTable)
                .where((eb) => eb.or(_data.map((d) => eb.and(d))))
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

        // validate connect result
        if (_data.length > updateResult[0]!.numUpdatedRows) {
            // some entities were not connected
            throw new NotFoundError(model);
        }
    }

    protected async connectOrCreateRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        const _data = enumerate(data);
        if (_data.length === 0) {
            return;
        }

        return Promise.all(
            _data.map(async ({ where, create }) => {
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
        data: any,
        fromRelation: {
            model: string;
            field: string;
            ids: any;
        }
    ) {
        let disconnectConditions: any[] = [];
        let expectedUpdateCount: number;
        if (typeof data === 'boolean') {
            if (data === false) {
                return;
            } else {
                disconnectConditions = [true];
                expectedUpdateCount = 1;
            }
        } else {
            disconnectConditions = enumerate(data);
            if (disconnectConditions.length === 0) {
                return;
            }
            expectedUpdateCount = disconnectConditions.length;
        }

        if (disconnectConditions.length === 0) {
            return;
        }

        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        let updateResult: UpdateResult[];

        if (ownedByModel) {
            // set parent fk directly
            invariant(
                disconnectConditions.length === 1,
                'only one entity can be disconnected'
            );
            const target = await this.readUnique(kysely, model, {
                where:
                    disconnectConditions[0] === true
                        ? {}
                        : disconnectConditions[0],
            });
            if (!target) {
                throw new NotFoundError(model);
            }
            const fromRelationModelDef = this.requireModel(fromRelation.model);
            updateResult = await kysely
                .updateTable(fromRelationModelDef.dbTable)
                .where((eb) => eb.and(fromRelation.ids))
                .set(
                    keyPairs.reduce(
                        (acc, { fk }) => ({ ...acc, [fk]: null }),
                        {} as any
                    )
                )
                .execute();
        } else {
            // disconnect
            updateResult = await kysely
                .updateTable(modelDef.dbTable)
                .where((eb) =>
                    eb.or(disconnectConditions.map((d) => eb.and(d)))
                )
                .set(
                    keyPairs.reduce(
                        (acc, { fk }) => ({ ...acc, [fk]: null }),
                        {} as any
                    )
                )
                .execute();
        }

        // validate connect result
        if (expectedUpdateCount > updateResult[0]!.numUpdatedRows) {
            // some entities were not connected
            throw new NotFoundError(model);
        }
    }

    protected async setRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext
    ) {
        const _data = enumerate(data);
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
                    eb.not(eb.or(_data.map((d) => eb.and(d)))),
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
        if (_data.length > 0) {
            const r = await kysely
                .updateTable(modelDef.dbTable)
                .where((eb) => eb.or(_data.map((d) => eb.and(d))))
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

            // validate result
            if (_data.length > r[0]!.numUpdatedRows) {
                // some entities were not connected
                throw new NotFoundError(model);
            }
        }
    }

    protected async deleteRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext,
        throwForNotFound: boolean
    ) {
        let deleteConditions: any[] = [];
        let expectedDeleteCount: number;
        if (typeof data === 'boolean') {
            if (data === false) {
                return;
            } else {
                deleteConditions = [true];
                expectedDeleteCount = 1;
            }
        } else {
            deleteConditions = enumerate(data);
            if (deleteConditions.length === 0) {
                return;
            }
            expectedDeleteCount = deleteConditions.length;
        }

        const modelDef = this.requireModel(model);
        const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromRelation.model,
            fromRelation.field
        );

        let deleteResult: DeleteResult[];
        if (ownedByModel) {
            const fromEntity = await this.readUnique(
                kysely,
                fromRelation.model as GetModels<Schema>,
                {
                    where: fromRelation.ids,
                }
            );
            if (!fromEntity) {
                throw new NotFoundError(model);
            }
            deleteResult = await kysely
                .deleteFrom(modelDef.dbTable)
                .where((eb) =>
                    eb.and([
                        eb.and(
                            keyPairs.map(({ fk, pk }) =>
                                eb(sql.ref(pk), '=', fromEntity[fk])
                            )
                        ),
                        eb.or(deleteConditions.map((d) => eb.and(d))),
                    ])
                )
                .execute();
        } else {
            deleteResult = await kysely
                .deleteFrom(modelDef.dbTable)
                .where((eb) =>
                    eb.and([
                        eb.and(
                            keyPairs.map(({ fk, pk }) =>
                                eb(sql.ref(fk), '=', fromRelation.ids[pk])
                            )
                        ),
                        eb.or(deleteConditions.map((d) => eb.and(d))),
                    ])
                )
                .execute();
        }

        // validate result
        if (
            throwForNotFound &&
            expectedDeleteCount > deleteResult[0]!.numDeletedRows
        ) {
            // some entities were not deleted
            throw new NotFoundError(model);
        }
    }

    protected async delete(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        returnData: boolean
    ): Promise<DeleteResult[] | unknown[]> {
        const modelDef = this.requireModel(model);
        return kysely
            .deleteFrom(modelDef.dbTable)
            .where((eb) =>
                this.dialect.buildFilter(eb, model, modelDef.dbTable, where)
            )
            .$if(returnData, (qb) => qb.returningAll())
            .execute();
    }

    protected makeIdSelect(model: string) {
        const modelDef = this.requireModel(model);
        return modelDef.idFields.reduce((acc, f) => {
            acc[f] = true;
            return acc;
        }, {} as any);
    }

    protected trimResult(
        data: any,
        args: SelectInclude<Schema, GetModels<Schema>>
    ) {
        if (!args.select) {
            return data;
        }
        return Object.keys(args.select).reduce((acc, field) => {
            acc[field] = data[field];
            return acc;
        }, {} as any);
    }

    protected needReturnRelations(
        model: string,
        args: SelectInclude<Schema, GetModels<Schema>>
    ) {
        let returnRelation = false;

        if (args.include) {
            returnRelation = Object.keys(args.include).length > 0;
        } else if (args.select) {
            returnRelation = Object.entries(args.select).some(([K, v]) => {
                const fieldDef = this.requireField(model, K);
                return fieldDef.relation && v;
            });
        }
        return returnRelation;
    }
}
