import { createId } from '@paralleldrive/cuid2';
import { invariant, isPlainObject } from '@zenstackhq/common-helpers';
import {
    DeleteResult,
    expressionBuilder,
    ExpressionWrapper,
    sql,
    UpdateResult,
    type Compilable,
    type IsolationLevel,
    type Expression as KyselyExpression,
    type QueryResult,
    type SelectQueryBuilder,
} from 'kysely';
import { nanoid } from 'nanoid';
import { inspect } from 'node:util';
import { match } from 'ts-pattern';
import { ulid } from 'ulid';
import * as uuid from 'uuid';
import type { ClientContract } from '../..';
import { PolicyPlugin } from '../../../plugins/policy';
import type { BuiltinType, Expression, FieldDef } from '../../../schema';
import { ExpressionUtils, type GetModels, type ModelDef, type SchemaDef } from '../../../schema';
import { clone } from '../../../utils/clone';
import { enumerate } from '../../../utils/enumerate';
import { extractFields, fieldsToSelectObject } from '../../../utils/object-utils';
import { CONTEXT_COMMENT_PREFIX, NUMERIC_FIELD_TYPES } from '../../constants';
import type { CRUD } from '../../contract';
import type { FindArgs, SelectIncludeOmit, SortOrder, WhereInput } from '../../crud-types';
import { InternalError, NotFoundError, QueryError } from '../../errors';
import type { ToKysely } from '../../query-builder';
import {
    buildFieldRef,
    buildJoinPairs,
    ensureArray,
    extractIdFields,
    flattenCompoundUniqueFilters,
    getDiscriminatorField,
    getField,
    getIdFields,
    getIdValues,
    getManyToManyRelation,
    getModel,
    getRelationForeignKeyFieldPairs,
    isForeignKeyField,
    isRelationField,
    isScalarField,
    makeDefaultOrderBy,
    requireField,
    requireModel,
    safeJSONStringify,
} from '../../query-utils';
import { getCrudDialect } from '../dialects';
import type { BaseCrudDialect } from '../dialects/base';
import { InputValidator } from '../validator';

export type CrudOperation =
    | 'findMany'
    | 'findUnique'
    | 'findFirst'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'count'
    | 'aggregate'
    | 'groupBy';

export type FromRelationContext<Schema extends SchemaDef> = {
    model: GetModels<Schema>;
    field: string;
    ids: any;
};

export abstract class BaseOperationHandler<Schema extends SchemaDef> {
    protected readonly dialect: BaseCrudDialect<Schema>;

    constructor(
        protected readonly client: ClientContract<Schema>,
        protected readonly model: GetModels<Schema>,
        protected readonly inputValidator: InputValidator<Schema>,
    ) {
        this.dialect = getCrudDialect(this.schema, this.client.$options);
    }

    protected get schema() {
        return this.client.$schema;
    }

    protected get options() {
        return this.client.$options;
    }

    protected get kysely() {
        return this.client.$qb;
    }

    abstract handle(operation: CrudOperation, args: any): Promise<unknown>;

    withClient(client: ClientContract<Schema>) {
        return new (this.constructor as new (...args: any[]) => this)(client, this.model, this.inputValidator);
    }

    // TODO: this is not clean, needs a better solution
    protected get hasPolicyEnabled() {
        return this.options.plugins?.some((plugin) => plugin instanceof PolicyPlugin);
    }

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

    protected async exists(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        filter: any,
    ): Promise<unknown | undefined> {
        const idFields = getIdFields(this.schema, model);
        const _filter = flattenCompoundUniqueFilters(this.schema, model, filter);
        const query = kysely
            .selectFrom(model)
            .where((eb) => eb.and(_filter))
            .select(idFields.map((f) => kysely.dynamic.ref(f)))
            .limit(1)
            .modifyEnd(this.makeContextComment({ model, operation: 'read' }));
        return this.executeQueryTakeFirst(kysely, query, 'exists');
    }

    protected async read(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true> | undefined,
    ): Promise<any[]> {
        // table
        let query = this.dialect.buildSelectModel(expressionBuilder(), model);

        // where
        if (args?.where) {
            query = query.where((eb) => this.dialect.buildFilter(eb, model, model, args?.where));
        }

        // skip && take
        let negateOrderBy = false;
        const skip = args?.skip;
        let take = args?.take;
        if (take !== undefined && take < 0) {
            negateOrderBy = true;
            take = -take;
        }
        query = this.dialect.buildSkipTake(query, skip, take);

        // orderBy
        query = this.dialect.buildOrderBy(
            query,
            model,
            model,
            args?.orderBy,
            skip !== undefined || take !== undefined,
            negateOrderBy,
        );

        // distinct
        let inMemoryDistinct: string[] | undefined = undefined;
        if (args?.distinct) {
            const distinct = ensureArray(args.distinct);
            if (this.dialect.supportsDistinctOn) {
                query = query.distinctOn(distinct.map((f: any) => sql.ref(`${model}.${f}`)));
            } else {
                // in-memory distinct after fetching all results
                inMemoryDistinct = distinct;
            }
        }

        // select
        if (args && 'select' in args && args.select) {
            // select is mutually exclusive with omit
            query = this.buildFieldSelection(model, query, args.select, model);
        } else {
            // include all scalar fields except those in omit
            query = this.dialect.buildSelectAllFields(model, query, (args as any)?.omit);
        }

        // include
        if (args && 'include' in args && args.include) {
            // note that 'omit' is handled above already
            query = this.buildFieldSelection(model, query, args.include, model);
        }

        if (args?.cursor) {
            query = this.buildCursorFilter(model, query, args.cursor, args.orderBy, negateOrderBy);
        }

        query = query.modifyEnd(this.makeContextComment({ model, operation: 'read' }));

        let result: any[] = [];
        const queryId = { queryId: `zenstack-${createId()}` };
        const compiled = kysely.getExecutor().compileQuery(query.toOperationNode(), queryId);
        try {
            const r = await kysely.getExecutor().executeQuery(compiled, queryId);
            result = r.rows;
        } catch (err) {
            let message = `Failed to execute query: ${err}, sql: ${compiled.sql}`;
            if (this.options.debug) {
                message += `, parameters: \n${compiled.parameters.map((p) => inspect(p)).join('\n')}`;
            }
            throw new QueryError(message, err);
        }

        if (inMemoryDistinct) {
            const distinctResult: Record<string, unknown>[] = [];
            const seen = new Set<string>();
            for (const r of result as any[]) {
                const key = safeJSONStringify(inMemoryDistinct.map((f) => r[f]))!;
                if (!seen.has(key)) {
                    distinctResult.push(r);
                    seen.add(key);
                }
            }
            result = distinctResult;
        }

        return result;
    }

    protected async readUnique(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: FindArgs<Schema, GetModels<Schema>, true>,
    ) {
        const result = await this.read(kysely, model, { ...args, take: 1 });
        return result[0] ?? null;
    }

    private buildFieldSelection(
        model: string,
        query: SelectQueryBuilder<any, any, any>,
        selectOrInclude: Record<string, any>,
        parentAlias: string,
    ) {
        let result = query;

        for (const [field, payload] of Object.entries(selectOrInclude)) {
            if (!payload) {
                continue;
            }

            if (field === '_count') {
                result = this.buildCountSelection(result, model, parentAlias, payload);
                continue;
            }

            const fieldDef = this.requireField(model, field);
            if (!fieldDef.relation) {
                // scalar field
                result = this.dialect.buildSelectField(result, model, parentAlias, field);
            } else {
                if (!fieldDef.array && !fieldDef.optional && payload.where) {
                    throw new QueryError(`Field "${field}" doesn't support filtering`);
                }
                if (fieldDef.originModel) {
                    result = this.dialect.buildRelationSelection(
                        result,
                        fieldDef.originModel,
                        field,
                        fieldDef.originModel,
                        payload,
                    );
                } else {
                    //  regular relation
                    result = this.dialect.buildRelationSelection(result, model, field, parentAlias, payload);
                }
            }
        }

        return result;
    }

    private buildCountSelection(
        query: SelectQueryBuilder<any, any, any>,
        model: string,
        parentAlias: string,
        payload: any,
    ) {
        const modelDef = requireModel(this.schema, model);
        const toManyRelations = Object.entries(modelDef.fields).filter(([, field]) => field.relation && field.array);

        const selections =
            payload === true
                ? {
                      select: toManyRelations.reduce(
                          (acc, [field]) => {
                              acc[field] = true;
                              return acc;
                          },
                          {} as Record<string, boolean>,
                      ),
                  }
                : payload;

        const eb = expressionBuilder<any, any>();
        const jsonObject: Record<string, KyselyExpression<any>> = {};

        for (const [field, value] of Object.entries(selections.select)) {
            const fieldDef = requireField(this.schema, model, field);
            const fieldModel = fieldDef.type;
            const joinPairs = buildJoinPairs(this.schema, model, parentAlias, field, fieldModel);

            // build a nested query to count the number of records in the relation
            let fieldCountQuery = eb.selectFrom(fieldModel).select(eb.fn.countAll().as(`_count$${field}`));

            // join conditions
            for (const [left, right] of joinPairs) {
                fieldCountQuery = fieldCountQuery.whereRef(left, '=', right);
            }

            // merge _count filter
            if (
                value &&
                typeof value === 'object' &&
                'where' in value &&
                value.where &&
                typeof value.where === 'object'
            ) {
                const filter = this.dialect.buildFilter(eb, fieldModel, fieldModel, value.where);
                fieldCountQuery = fieldCountQuery.where(filter);
            }

            jsonObject[field] = fieldCountQuery;
        }

        query = query.select((eb) => this.dialect.buildJsonObject(eb, jsonObject).as('_count'));

        return query;
    }

    private buildCursorFilter(
        model: string,
        query: SelectQueryBuilder<any, any, any>,
        cursor: FindArgs<Schema, GetModels<Schema>, true>['cursor'],
        orderBy: FindArgs<Schema, GetModels<Schema>, true>['orderBy'],
        negateOrderBy: boolean,
    ) {
        if (!orderBy) {
            orderBy = makeDefaultOrderBy(this.schema, model);
        }

        const orderByItems = ensureArray(orderBy).flatMap((obj) => Object.entries<SortOrder>(obj));

        const eb = expressionBuilder<any, any>();
        const cursorFilter = this.dialect.buildFilter(eb, model, model, cursor);

        let result = query;
        const filters: ExpressionWrapper<any, any, any>[] = [];

        for (let i = orderByItems.length - 1; i >= 0; i--) {
            const andFilters: ExpressionWrapper<any, any, any>[] = [];

            for (let j = 0; j <= i; j++) {
                const [field, order] = orderByItems[j]!;
                const _order = negateOrderBy ? (order === 'asc' ? 'desc' : 'asc') : order;
                const op = j === i ? (_order === 'asc' ? '>=' : '<=') : '=';
                andFilters.push(
                    eb(
                        eb.ref(`${model}.${field}`),
                        op,
                        eb.selectFrom(model).select(`${model}.${field}`).where(cursorFilter),
                    ),
                );
            }

            filters.push(eb.and(andFilters));
        }

        result = result.where((eb) => eb.or(filters));

        return result;
    }

    protected async create(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation?: FromRelationContext<Schema>,
        creatingForDelegate = false,
    ): Promise<unknown> {
        const modelDef = this.requireModel(model);

        // additional validations
        if (modelDef.isDelegate && !creatingForDelegate) {
            throw new QueryError(`Model "${this.model}" is a delegate and cannot be created directly.`);
        }

        let createFields: any = {};
        let parentUpdateTask: ((entity: any) => Promise<unknown>) | undefined = undefined;

        let m2m: ReturnType<typeof getManyToManyRelation> = undefined;

        if (fromRelation) {
            m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);
            if (!m2m) {
                // many-to-many relations are handled after create
                const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                    this.schema,
                    fromRelation?.model ?? '',
                    fromRelation?.field ?? '',
                );

                if (!ownedByModel) {
                    // assign fks from parent
                    const parentFkFields = this.buildFkAssignments(
                        fromRelation.model,
                        fromRelation.field,
                        fromRelation.ids,
                    );
                    Object.assign(createFields, parentFkFields);
                } else {
                    parentUpdateTask = (entity) => {
                        const query = kysely
                            .updateTable(fromRelation.model)
                            .set(
                                keyPairs.reduce(
                                    (acc, { fk, pk }) => ({
                                        ...acc,
                                        [fk]: entity[pk],
                                    }),
                                    {} as any,
                                ),
                            )
                            .where((eb) => eb.and(fromRelation.ids))
                            .modifyEnd(
                                this.makeContextComment({
                                    model: fromRelation.model,
                                    operation: 'update',
                                }),
                            );
                        return this.executeQuery(kysely, query, 'update');
                    };
                }
            }
        }

        // process the create and handle relations
        const postCreateRelations: Record<string, object> = {};
        for (const [field, value] of Object.entries(data)) {
            const fieldDef = this.requireField(model, field);
            if (isScalarField(this.schema, model, field) || isForeignKeyField(this.schema, model, field)) {
                if (
                    fieldDef.array &&
                    value &&
                    typeof value === 'object' &&
                    'set' in value &&
                    Array.isArray(value.set)
                ) {
                    // deal with nested "set" for scalar lists
                    createFields[field] = this.dialect.transformPrimitive(
                        value.set,
                        fieldDef.type as BuiltinType,
                        true,
                    );
                } else {
                    createFields[field] = this.dialect.transformPrimitive(
                        value,
                        fieldDef.type as BuiltinType,
                        !!fieldDef.array,
                    );
                }
            } else {
                const subM2M = getManyToManyRelation(this.schema, model, field);
                if (!subM2M && fieldDef.relation?.fields && fieldDef.relation?.references) {
                    const fkValues = await this.processOwnedRelationForCreate(kysely, fieldDef, value);
                    for (let i = 0; i < fieldDef.relation.fields.length; i++) {
                        createFields[fieldDef.relation.fields[i]!] = fkValues[fieldDef.relation.references[i]!];
                    }
                } else {
                    const subPayload = value;
                    if (subPayload && typeof subPayload === 'object') {
                        postCreateRelations[field] = subPayload;
                    }
                }
            }
        }

        // create delegate base model entity
        if (modelDef.baseModel) {
            const baseCreateResult = await this.processBaseModelCreate(kysely, modelDef.baseModel, createFields, model);
            createFields = baseCreateResult.remainingFields;
        }

        const updatedData = this.fillGeneratedValues(modelDef, createFields);
        const idFields = getIdFields(this.schema, model);
        const query = kysely
            .insertInto(model)
            .$if(Object.keys(updatedData).length === 0, (qb) => qb.defaultValues())
            .$if(Object.keys(updatedData).length > 0, (qb) => qb.values(updatedData))
            .returning(idFields as any)
            .modifyEnd(
                this.makeContextComment({
                    model,
                    operation: 'create',
                }),
            );

        const createdEntity = await this.executeQueryTakeFirst(kysely, query, 'create');

        // try {
        //     createdEntity = await this.executeQueryTakeFirst(kysely, query, 'create');
        // } catch (err) {
        //     const { sql, parameters } = query.compile();
        //     throw new QueryError(
        //         `Error during create: ${err}, sql: ${sql}, parameters: ${parameters}`
        //     );
        // }

        if (Object.keys(postCreateRelations).length > 0) {
            // process nested creates that need to happen after the current entity is created
            const relationPromises = Object.entries(postCreateRelations).map(([field, subPayload]) => {
                return this.processNoneOwnedRelationForCreate(kysely, model, field, subPayload, createdEntity);
            });

            // await relation creation
            await Promise.all(relationPromises);
        }

        if (fromRelation && m2m) {
            // connect many-to-many relation
            await this.handleManyToManyRelation(
                kysely,
                'connect',
                fromRelation.model,
                fromRelation.field,
                fromRelation.ids,
                m2m.otherModel,
                m2m.otherField,
                createdEntity,
                m2m.joinTable,
            );
        }

        // finally update parent if needed
        if (parentUpdateTask) {
            await parentUpdateTask(createdEntity);
        }

        return createdEntity;
    }

    private async processBaseModelCreate(kysely: ToKysely<Schema>, model: string, createFields: any, forModel: string) {
        const thisCreateFields: any = {};
        const remainingFields: any = {};

        Object.entries(createFields).forEach(([field, value]) => {
            const fieldDef = this.getField(model, field);
            if (fieldDef) {
                thisCreateFields[field] = value;
            } else {
                remainingFields[field] = value;
            }
        });

        const discriminatorField = getDiscriminatorField(this.schema, model);
        invariant(discriminatorField, `Base model "${model}" must have a discriminator field`);
        thisCreateFields[discriminatorField] = forModel;

        // create base model entity
        const baseEntity: any = await this.create(
            kysely,
            model as GetModels<Schema>,
            thisCreateFields,
            undefined,
            true,
        );

        // copy over id fields from base model
        const idValues = extractIdFields(baseEntity, this.schema, model);
        Object.assign(remainingFields, idValues);

        return { baseEntity, remainingFields };
    }

    private buildFkAssignments(model: string, relationField: string, entity: any) {
        const parentFkFields: any = {};

        invariant(relationField, 'parentField must be defined if parentModel is defined');
        invariant(entity, 'parentEntity must be defined if parentModel is defined');

        const { keyPairs } = getRelationForeignKeyFieldPairs(this.schema, model, relationField);

        for (const pair of keyPairs) {
            if (!(pair.pk in entity)) {
                throw new QueryError(`Field "${pair.pk}" not found in parent created data`);
            }
            Object.assign(parentFkFields, {
                [pair.fk]: (entity as any)[pair.pk],
            });
        }
        return parentFkFields;
    }

    private async handleManyToManyRelation<Action extends 'connect' | 'disconnect'>(
        kysely: ToKysely<Schema>,
        action: Action,
        leftModel: string,
        leftField: string,
        leftEntity: any,
        rightModel: string,
        rightField: string,
        rightEntity: any,
        joinTable: string,
    ): Promise<Action extends 'connect' ? UpdateResult | undefined : DeleteResult | undefined> {
        const sortedRecords = [
            {
                model: leftModel,
                field: leftField,
                entity: leftEntity,
            },
            {
                model: rightModel,
                field: rightField,
                entity: rightEntity,
            },
        ].sort((a, b) => a.model.localeCompare(b.model));

        const firstIds = getIdFields(this.schema, sortedRecords[0]!.model);
        const secondIds = getIdFields(this.schema, sortedRecords[1]!.model);
        invariant(firstIds.length === 1, 'many-to-many relation must have exactly one id field');
        invariant(secondIds.length === 1, 'many-to-many relation must have exactly one id field');

        // Prisma's convention for many-to-many: fk fields are named "A" and "B"
        if (action === 'connect') {
            const result = await kysely
                .insertInto(joinTable as any)
                .values({
                    A: sortedRecords[0]!.entity[firstIds[0]!],
                    B: sortedRecords[1]!.entity[secondIds[0]!],
                } as any)
                .onConflict((oc) => oc.columns(['A', 'B'] as any).doNothing())
                .execute();
            return result[0] as any;
        } else {
            const eb = expressionBuilder<any, any>();
            const result = await kysely
                .deleteFrom(joinTable as any)
                .where(eb(`${joinTable}.A`, '=', sortedRecords[0]!.entity[firstIds[0]!]))
                .where(eb(`${joinTable}.B`, '=', sortedRecords[1]!.entity[secondIds[0]!]))
                .execute();
            return result[0] as any;
        }
    }

    private resetManyToManyRelation(kysely: ToKysely<Schema>, model: GetModels<Schema>, field: string, parentIds: any) {
        invariant(Object.keys(parentIds).length === 1, 'parentIds must have exactly one field');
        const parentId = Object.values(parentIds)[0]!;

        const m2m = getManyToManyRelation(this.schema, model, field);
        invariant(m2m, 'not a many-to-many relation');

        const eb = expressionBuilder<any, any>();
        return kysely
            .deleteFrom(m2m.joinTable as any)
            .where(eb(`${m2m.joinTable}.${m2m.parentFkName}`, '=', parentId))
            .execute();
    }

    private async processOwnedRelationForCreate(kysely: ToKysely<Schema>, relationField: FieldDef, payload: any) {
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
                    const created = await this.create(kysely, relationModel, subPayload);
                    // extract id fields and return as foreign key values
                    result = getIdValues(this.schema, relationField.type, created);
                    break;
                }

                case 'connect': {
                    const referencedPkFields = relationField.relation!.references!;
                    invariant(referencedPkFields, 'relation must have fields info');
                    const extractedFks = extractFields(subPayload, referencedPkFields);
                    if (Object.keys(extractedFks).length === referencedPkFields.length) {
                        // payload contains all referenced pk fields, we can
                        // directly use it to connect the relation
                        result = extractedFks;
                    } else {
                        // read the relation entity and fetch the referenced pk fields
                        const relationEntity = await this.readUnique(kysely, relationModel, {
                            where: subPayload,
                            select: fieldsToSelectObject(referencedPkFields) as any,
                        });
                        if (!relationEntity) {
                            throw new NotFoundError(`Could not find the entity for connect action`);
                        }
                        result = relationEntity;
                    }
                    break;
                }

                case 'connectOrCreate': {
                    const found = await this.exists(kysely, relationModel, subPayload.where);
                    if (!found) {
                        // create
                        const created = await this.create(kysely, relationModel, subPayload.create);
                        result = getIdValues(this.schema, relationField.type, created);
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

    private processNoneOwnedRelationForCreate(
        kysely: ToKysely<Schema>,
        contextModel: GetModels<Schema>,
        relationFieldName: string,
        payload: any,
        parentEntity: any,
    ) {
        const relationFieldDef = this.requireField(contextModel, relationFieldName);
        const relationModel = relationFieldDef.type as GetModels<Schema>;
        const tasks: Promise<unknown>[] = [];
        const fromRelationContext = {
            model: contextModel,
            field: relationFieldName,
            ids: parentEntity,
        };

        for (const [action, subPayload] of Object.entries<any>(payload)) {
            if (!subPayload) {
                continue;
            }
            switch (action) {
                case 'create': {
                    // create with a parent entity
                    tasks.push(
                        ...enumerate(subPayload).map((item) =>
                            this.create(kysely, relationModel, item, fromRelationContext),
                        ),
                    );
                    break;
                }

                case 'createMany': {
                    invariant(relationFieldDef.array, 'relation must be an array for createMany');
                    tasks.push(
                        this.createMany(
                            kysely,
                            relationModel,
                            subPayload as { data: any; skipDuplicates: boolean },
                            false,
                            fromRelationContext,
                        ),
                    );
                    break;
                }

                case 'connect': {
                    tasks.push(
                        this.connectRelation(kysely, relationModel, subPayload, {
                            model: contextModel,
                            field: relationFieldName,
                            ids: parentEntity,
                        }),
                    );
                    break;
                }

                case 'connectOrCreate': {
                    tasks.push(
                        ...enumerate(subPayload).map((item) =>
                            this.exists(kysely, relationModel, item.where).then((found) =>
                                !found
                                    ? this.create(kysely, relationModel, item.create, {
                                          model: contextModel,
                                          field: relationFieldName,
                                          ids: parentEntity,
                                      })
                                    : this.connectRelation(kysely, relationModel, found, {
                                          model: contextModel,
                                          field: relationFieldName,
                                          ids: parentEntity,
                                      }),
                            ),
                        ),
                    );
                    break;
                }

                default:
                    throw new QueryError(`Invalid relation action: ${action}`);
            }
        }

        return Promise.all(tasks);
    }

    protected async createMany<
        ReturnData extends boolean,
        Result = ReturnData extends true ? unknown[] : { count: number },
    >(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        input: { data: any; skipDuplicates?: boolean },
        returnData: ReturnData,
        fromRelation?: FromRelationContext<Schema>,
    ): Promise<Result> {
        if (!input.data || (Array.isArray(input.data) && input.data.length === 0)) {
            // nothing todo
            return returnData ? ([] as Result) : ({ count: 0 } as Result);
        }

        const modelDef = this.requireModel(model);

        let relationKeyPairs: { fk: string; pk: string }[] = [];
        if (fromRelation) {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field,
            );
            if (ownedByModel) {
                throw new QueryError('incorrect relation hierarchy for createMany');
            }
            relationKeyPairs = keyPairs;
        }

        let createData = enumerate(input.data).map((item) => {
            const newItem: any = {};
            for (const [name, value] of Object.entries(item)) {
                const fieldDef = this.requireField(model, name);
                invariant(!fieldDef.relation, 'createMany does not support relations');
                newItem[name] = this.dialect.transformPrimitive(value, fieldDef.type as BuiltinType, !!fieldDef.array);
            }
            if (fromRelation) {
                for (const { fk, pk } of relationKeyPairs) {
                    newItem[fk] = fromRelation.ids[pk];
                }
            }
            return this.fillGeneratedValues(modelDef, newItem);
        });

        if (modelDef.baseModel) {
            if (input.skipDuplicates) {
                // TODO: simulate createMany with create in this case
                throw new QueryError('"skipDuplicates" options is not supported for polymorphic models');
            }
            // create base hierarchy
            const baseCreateResult = await this.processBaseModelCreateMany(
                kysely,
                modelDef.baseModel,
                createData,
                !!input.skipDuplicates,
                model,
            );
            createData = baseCreateResult.remainingFieldRows;
        }

        const query = kysely
            .insertInto(model)
            .values(createData)
            .$if(!!input.skipDuplicates, (qb) => qb.onConflict((oc) => oc.doNothing()))
            .modifyEnd(
                this.makeContextComment({
                    model,
                    operation: 'create',
                }),
            );

        if (!returnData) {
            const result = await this.executeQuery(kysely, query, 'createMany');
            return { count: Number(result.numAffectedRows) } as Result;
        } else {
            const idFields = getIdFields(this.schema, model);
            const result = await query.returning(idFields as any).execute();
            return result as Result;
        }
    }

    private async processBaseModelCreateMany(
        kysely: ToKysely<Schema>,
        model: string,
        createRows: any[],
        skipDuplicates: boolean,
        forModel: GetModels<Schema>,
    ) {
        const thisCreateRows: any[] = [];
        const remainingFieldRows: any[] = [];
        const discriminatorField = getDiscriminatorField(this.schema, model);
        invariant(discriminatorField, `Base model "${model}" must have a discriminator field`);

        for (const createFields of createRows) {
            const thisCreateFields: any = {};
            const remainingFields: any = {};
            Object.entries(createFields).forEach(([field, value]) => {
                const fieldDef = this.getField(model, field);
                if (fieldDef) {
                    thisCreateFields[field] = value;
                } else {
                    remainingFields[field] = value;
                }
            });
            thisCreateFields[discriminatorField] = forModel;
            thisCreateRows.push(thisCreateFields);
            remainingFieldRows.push(remainingFields);
        }

        // create base model entity
        const baseEntities = await this.createMany(
            kysely,
            model as GetModels<Schema>,
            { data: thisCreateRows, skipDuplicates },
            true,
        );

        // copy over id fields from base model
        for (let i = 0; i < baseEntities.length; i++) {
            const idValues = extractIdFields(baseEntities[i], this.schema, model);
            Object.assign(remainingFieldRows[i], idValues);
        }
        return { baseEntities, remainingFieldRows };
    }

    private fillGeneratedValues(modelDef: ModelDef, data: object) {
        const fields = modelDef.fields;
        const values: any = clone(data);
        for (const [field, fieldDef] of Object.entries(fields)) {
            if (fieldDef.originModel) {
                // skip fields from delegate base
                continue;
            }
            if (!(field in data)) {
                if (typeof fields[field]?.default === 'object' && 'kind' in fields[field].default) {
                    const generated = this.evalGenerator(fields[field].default);
                    if (generated !== undefined) {
                        values[field] = generated;
                    }
                } else if (fields[field]?.updatedAt) {
                    // TODO: should this work at kysely level instead?
                    values[field] = this.dialect.transformPrimitive(new Date(), 'DateTime', false);
                }
            }
        }
        return values;
    }

    private evalGenerator(defaultValue: Expression) {
        if (ExpressionUtils.isCall(defaultValue)) {
            return match(defaultValue.function)
                .with('cuid', () => createId())
                .with('uuid', () =>
                    defaultValue.args?.[0] &&
                    ExpressionUtils.isLiteral(defaultValue.args?.[0]) &&
                    defaultValue.args[0].value === 7
                        ? uuid.v7()
                        : uuid.v4(),
                )
                .with('nanoid', () =>
                    defaultValue.args?.[0] &&
                    ExpressionUtils.isLiteral(defaultValue.args[0]) &&
                    typeof defaultValue.args[0].value === 'number'
                        ? nanoid(defaultValue.args[0].value)
                        : nanoid(),
                )
                .with('ulid', () => ulid())
                .otherwise(() => undefined);
        } else if (
            ExpressionUtils.isMember(defaultValue) &&
            ExpressionUtils.isCall(defaultValue.receiver) &&
            defaultValue.receiver.function === 'auth'
        ) {
            // `auth()` member access
            let val: any = this.client.$auth;
            for (const member of defaultValue.members) {
                val = val?.[member];
            }
            return val ?? null;
        } else {
            return undefined;
        }
    }

    protected async update(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        data: any,
        fromRelation?: FromRelationContext<Schema>,
        allowRelationUpdate = true,
        throwIfNotFound = true,
    ): Promise<unknown> {
        if (!data || typeof data !== 'object') {
            throw new InternalError('data must be an object');
        }

        const parentWhere: any = {};
        let m2m: ReturnType<typeof getManyToManyRelation> = undefined;

        if (fromRelation) {
            m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);
            if (!m2m) {
                // merge foreign key conditions from the relation
                const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                    this.schema,
                    fromRelation.model,
                    fromRelation.field,
                );
                if (ownedByModel) {
                    const fromEntity = await this.readUnique(kysely, fromRelation.model as GetModels<Schema>, {
                        where: fromRelation.ids,
                    });
                    for (const { fk, pk } of keyPairs) {
                        parentWhere[pk] = fromEntity[fk];
                    }
                } else {
                    for (const { fk, pk } of keyPairs) {
                        parentWhere[fk] = fromRelation.ids[pk];
                    }
                }
            } else {
                // many-to-many relation, filter for parent with "some"
                const fromRelationFieldDef = this.requireField(fromRelation.model, fromRelation.field);
                invariant(fromRelationFieldDef.relation?.opposite);
                parentWhere[fromRelationFieldDef.relation.opposite] = {
                    some: fromRelation.ids,
                };
            }
        }

        let combinedWhere: WhereInput<Schema, GetModels<Schema>, false> = where ?? {};
        if (Object.keys(parentWhere).length > 0) {
            combinedWhere = Object.keys(combinedWhere).length > 0 ? { AND: [parentWhere, combinedWhere] } : parentWhere;
        }

        // fill in automatically updated fields
        const modelDef = this.requireModel(model);
        let finalData = data;
        for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
            if (fieldDef.updatedAt) {
                if (finalData === data) {
                    finalData = clone(data);
                }
                finalData[fieldName] = this.dialect.transformPrimitive(new Date(), 'DateTime', false);
            }
        }

        if (Object.keys(finalData).length === 0) {
            // nothing to update, return the original filter so that caller can identify the entity
            return combinedWhere;
        }

        let needIdRead = false;
        if (modelDef.baseModel && !this.isIdFilter(model, combinedWhere)) {
            // when updating a model with delegate base, base fields may be referenced in the filter,
            // so we read the id out if the filter is not ready an id filter, and and use it as the
            // update filter instead
            needIdRead = true;
        }

        if (needIdRead) {
            const readResult = await this.readUnique(kysely, model, {
                where: combinedWhere,
                select: this.makeIdSelect(model),
            });
            if (!readResult && throwIfNotFound) {
                throw new NotFoundError(model);
            }
            combinedWhere = readResult;
        }

        if (modelDef.baseModel) {
            const baseUpdateResult = await this.processBaseModelUpdate(
                kysely,
                modelDef.baseModel,
                combinedWhere,
                finalData,
                throwIfNotFound,
            );
            // only fields not consumed by base update will be used for this model
            finalData = baseUpdateResult.remainingFields;
            // base update may change entity ids, update the filter
            combinedWhere = baseUpdateResult.baseEntity;
        }

        const updateFields: any = {};
        let thisEntity: any = undefined;

        for (const field in finalData) {
            const fieldDef = this.requireField(model, field);
            if (isScalarField(this.schema, model, field) || isForeignKeyField(this.schema, model, field)) {
                updateFields[field] = this.processScalarFieldUpdateData(model, field, finalData);
            } else {
                if (!allowRelationUpdate) {
                    throw new QueryError(`Relation update not allowed for field "${field}"`);
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
                    finalData[field],
                    throwIfNotFound,
                );
            }
        }

        if (Object.keys(updateFields).length === 0) {
            // nothing to update, return the filter so that the caller can identify the entity
            return combinedWhere;
        } else {
            const idFields = getIdFields(this.schema, model);
            const query = kysely
                .updateTable(model)
                .where((eb) => this.dialect.buildFilter(eb, model, model, combinedWhere))
                .set(updateFields)
                .returning(idFields as any)
                .modifyEnd(
                    this.makeContextComment({
                        model,
                        operation: 'update',
                    }),
                );

            const updatedEntity = await this.executeQueryTakeFirst(kysely, query, 'update');

            // try {
            //     updatedEntity = await this.executeQueryTakeFirst(kysely, query, 'update');
            // } catch (err) {
            //     const { sql, parameters } = query.compile();
            //     throw new QueryError(
            //         `Error during update: ${err}, sql: ${sql}, parameters: ${parameters}`
            //     );
            // }

            if (!updatedEntity) {
                if (throwIfNotFound) {
                    throw new NotFoundError(model);
                } else {
                    return null;
                }
            }

            return updatedEntity;
        }
    }

    private processScalarFieldUpdateData(model: GetModels<Schema>, field: string, data: any): any {
        const fieldDef = this.requireField(model, field);
        if (this.isNumericIncrementalUpdate(fieldDef, data[field])) {
            // numeric fields incremental updates
            return this.transformIncrementalUpdate(model, field, fieldDef, data[field]);
        }

        if (fieldDef.array && typeof data[field] === 'object' && !Array.isArray(data[field]) && data[field]) {
            // scalar list updates
            return this.transformScalarListUpdate(model, field, fieldDef, data[field]);
        }

        return this.dialect.transformPrimitive(data[field], fieldDef.type as BuiltinType, !!fieldDef.array);
    }

    private isNumericIncrementalUpdate(fieldDef: FieldDef, value: any) {
        if (!this.isNumericField(fieldDef)) {
            return false;
        }
        if (typeof value !== 'object' || !value) {
            return false;
        }
        return ['increment', 'decrement', 'multiply', 'divide', 'set'].some((key) => key in value);
    }

    private isIdFilter(model: GetModels<Schema>, filter: any) {
        if (!filter || typeof filter !== 'object') {
            return false;
        }
        const idFields = getIdFields(this.schema, model);
        return idFields.length === Object.keys(filter).length && idFields.every((field) => field in filter);
    }

    private async processBaseModelUpdate(
        kysely: ToKysely<Schema>,
        model: string,
        where: any,
        updateFields: any,
        throwIfNotFound: boolean,
    ) {
        const thisUpdateFields: any = {};
        const remainingFields: any = {};

        Object.entries(updateFields).forEach(([field, value]) => {
            const fieldDef = this.getField(model, field);
            if (fieldDef) {
                thisUpdateFields[field] = value;
            } else {
                remainingFields[field] = value;
            }
        });

        // update base model entity
        const baseEntity: any = await this.update(
            kysely,
            model as GetModels<Schema>,
            where,
            thisUpdateFields,
            undefined,
            undefined,
            throwIfNotFound,
        );
        return { baseEntity, remainingFields };
    }

    private transformIncrementalUpdate(
        model: GetModels<Schema>,
        field: string,
        fieldDef: FieldDef,
        payload: Record<string, number | null>,
    ) {
        invariant(
            Object.keys(payload).length === 1,
            'Only one of "set", "increment", "decrement", "multiply", or "divide" can be provided',
        );

        const key = Object.keys(payload)[0];
        const value = this.dialect.transformPrimitive(payload[key!], fieldDef.type as BuiltinType, false);
        const eb = expressionBuilder<any, any>();
        const fieldRef = buildFieldRef(this.schema, model, field, this.options, eb);

        return match(key)
            .with('set', () => value)
            .with('increment', () => eb(fieldRef, '+', value))
            .with('decrement', () => eb(fieldRef, '-', value))
            .with('multiply', () => eb(fieldRef, '*', value))
            .with('divide', () => eb(fieldRef, '/', value))
            .otherwise(() => {
                throw new InternalError(`Invalid incremental update operation: ${key}`);
            });
    }

    private transformScalarListUpdate(
        model: GetModels<Schema>,
        field: string,
        fieldDef: FieldDef,
        payload: Record<string, unknown>,
    ) {
        invariant(Object.keys(payload).length === 1, 'Only one of "set", "push" can be provided');
        const key = Object.keys(payload)[0];
        const value = this.dialect.transformPrimitive(payload[key!], fieldDef.type as BuiltinType, true);
        const eb = expressionBuilder<any, any>();
        const fieldRef = buildFieldRef(this.schema, model, field, this.options, eb);

        return match(key)
            .with('set', () => value)
            .with('push', () => {
                return eb(fieldRef, '||', eb.val(ensureArray(value)));
            })
            .otherwise(() => {
                throw new InternalError(`Invalid array update operation: ${key}`);
            });
    }

    private isNumericField(fieldDef: FieldDef) {
        return NUMERIC_FIELD_TYPES.includes(fieldDef.type) && !fieldDef.array;
    }

    private makeContextComment(context: { model: GetModels<Schema>; operation: CRUD }) {
        return sql.raw(`${CONTEXT_COMMENT_PREFIX}${JSON.stringify(context)}`);
    }

    protected async updateMany<
        ReturnData extends boolean,
        Result = ReturnData extends true ? unknown[] : { count: number },
    >(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        data: any,
        limit: number | undefined,
        returnData: ReturnData,
        filterModel?: GetModels<Schema>,
    ): Promise<Result> {
        if (typeof data !== 'object') {
            throw new InternalError('data must be an object');
        }

        if (Object.keys(data).length === 0) {
            return (returnData ? [] : { count: 0 }) as Result;
        }

        const modelDef = this.requireModel(model);
        if (modelDef.baseModel && limit !== undefined) {
            throw new QueryError('Updating with a limit is not supported for polymorphic models');
        }

        filterModel ??= model;
        let updateFields: any = {};

        for (const field in data) {
            if (isRelationField(this.schema, model, field)) {
                continue;
            }
            updateFields[field] = this.processScalarFieldUpdateData(model, field, data);
        }

        let shouldFallbackToIdFilter = false;

        if (limit !== undefined && !this.dialect.supportsUpdateWithLimit) {
            // if the dialect doesn't support update with limit natively, we'll
            // simulate it by filtering by id with a limit
            shouldFallbackToIdFilter = true;
        }

        if (modelDef.isDelegate || modelDef.baseModel) {
            // if the model is in a delegate hierarchy, we'll need to filter by
            // id because the filter may involve fields in different models in
            // the hierarchy
            shouldFallbackToIdFilter = true;
        }

        let resultFromBaseModel: any = undefined;
        if (modelDef.baseModel) {
            const baseResult = await this.processBaseModelUpdateMany(
                kysely,
                modelDef.baseModel,
                where,
                updateFields,
                filterModel,
            );
            updateFields = baseResult.remainingFields;
            resultFromBaseModel = baseResult.baseResult;
        }

        // check again if we don't have anything to update for this model
        if (Object.keys(updateFields).length === 0) {
            // return result from base model if it exists, otherwise return empty result
            return resultFromBaseModel ?? ((returnData ? [] : { count: 0 }) as Result);
        }

        let query = kysely.updateTable(model).set(updateFields);

        if (!shouldFallbackToIdFilter) {
            // simple filter
            query = query
                .where((eb) => this.dialect.buildFilter(eb, model, model, where))
                .$if(limit !== undefined, (qb) => qb.limit(limit!));
        } else {
            query = query.where((eb) =>
                eb(
                    eb.refTuple(
                        // @ts-expect-error
                        ...this.buildIdFieldRefs(kysely, model),
                    ),
                    'in',
                    this.dialect
                        .buildSelectModel(eb, filterModel)
                        .where(this.dialect.buildFilter(eb, filterModel, filterModel, where))
                        .select(this.buildIdFieldRefs(kysely, filterModel))
                        .$if(limit !== undefined, (qb) => qb.limit(limit!)),
                ),
            );
        }

        query = query.modifyEnd(this.makeContextComment({ model, operation: 'update' }));

        if (!returnData) {
            const result = await this.executeQuery(kysely, query, 'update');
            return { count: Number(result.numAffectedRows) } as Result;
        } else {
            const idFields = getIdFields(this.schema, model);
            const result = await query.returning(idFields as any).execute();
            return result as Result;
        }
    }

    private async processBaseModelUpdateMany(
        kysely: ToKysely<Schema>,
        model: string,
        where: any,
        updateFields: any,
        filterModel: GetModels<Schema>,
    ) {
        const thisUpdateFields: any = {};
        const remainingFields: any = {};

        Object.entries(updateFields).forEach(([field, value]) => {
            const fieldDef = this.getField(model, field);
            if (fieldDef) {
                thisUpdateFields[field] = value;
            } else {
                remainingFields[field] = value;
            }
        });

        // update base model entity
        const baseResult: any = await this.updateMany(
            kysely,
            model as GetModels<Schema>,
            where,
            thisUpdateFields,
            undefined,
            false,
            filterModel,
        );
        return { baseResult, remainingFields };
    }

    private buildIdFieldRefs(kysely: ToKysely<Schema>, model: GetModels<Schema>) {
        const idFields = getIdFields(this.schema, model);
        return idFields.map((f) => kysely.dynamic.ref(`${model}.${f}`));
    }

    private async processRelationUpdates(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        field: string,
        fieldDef: FieldDef,
        parentIds: any,
        args: any,
        throwIfNotFound: boolean,
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
                        'relation must be an array if create is an array',
                    );
                    tasks.push(
                        ...enumerate(value).map((item) => this.create(kysely, fieldModel, item, fromRelationContext)),
                    );
                    break;
                }

                case 'createMany': {
                    invariant(fieldDef.array, 'relation must be an array for createMany');
                    tasks.push(
                        this.createMany(
                            kysely,
                            fieldModel,
                            value as { data: any; skipDuplicates: boolean },
                            false,
                            fromRelationContext,
                        ),
                    );
                    break;
                }

                case 'connect': {
                    tasks.push(this.connectRelation(kysely, fieldModel, value, fromRelationContext));
                    break;
                }

                case 'connectOrCreate': {
                    tasks.push(this.connectOrCreateRelation(kysely, fieldModel, value, fromRelationContext));
                    break;
                }

                case 'disconnect': {
                    tasks.push(this.disconnectRelation(kysely, fieldModel, value, fromRelationContext));
                    break;
                }

                case 'set': {
                    invariant(fieldDef.array, 'relation must be an array');
                    tasks.push(this.setRelation(kysely, fieldModel, value, fromRelationContext));
                    break;
                }

                case 'update': {
                    tasks.push(
                        ...(enumerate(value) as { where: any; data: any }[]).map((item) => {
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
                                throwIfNotFound,
                            );
                        }),
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
                                false,
                            );
                            if (updated) {
                                return updated;
                            } else {
                                return this.create(kysely, fieldModel, item.create, fromRelationContext);
                            }
                        }),
                    );
                    break;
                }

                case 'updateMany': {
                    tasks.push(
                        ...(enumerate(value) as { where: any; data: any }[]).map((item) =>
                            this.update(kysely, fieldModel, item.where, item.data, fromRelationContext, false, false),
                        ),
                    );
                    break;
                }

                case 'delete': {
                    tasks.push(this.deleteRelation(kysely, fieldModel, value, fromRelationContext, true));
                    break;
                }

                case 'deleteMany': {
                    tasks.push(this.deleteRelation(kysely, fieldModel, value, fromRelationContext, false));
                    break;
                }

                default: {
                    throw new Error('Not implemented yet');
                }
            }
        }

        await Promise.all(tasks);
    }

    // #region relation manipulation

    protected async connectRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext<Schema>,
    ) {
        const _data = this.normalizeRelationManipulationInput(model, data);
        if (_data.length === 0) {
            return;
        }

        const m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);
        if (m2m) {
            // handle many-to-many relation
            const actions = _data.map(async (d) => {
                const ids = await this.getEntityIds(kysely, model, d);
                return this.handleManyToManyRelation(
                    kysely,
                    'connect',
                    fromRelation.model,
                    fromRelation.field,
                    fromRelation.ids,
                    m2m.otherModel!,
                    m2m.otherField!,
                    ids,
                    m2m.joinTable,
                );
            });
            const results = await Promise.all(actions);

            // validate connect result
            if (_data.length > results.filter((r) => !!r).length) {
                throw new NotFoundError(model);
            }
        } else {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field,
            );
            let updateResult: QueryResult<unknown>;

            if (ownedByModel) {
                // set parent fk directly
                invariant(_data.length === 1, 'only one entity can be connected');
                const target = await this.readUnique(kysely, model, {
                    where: _data[0],
                });
                if (!target) {
                    throw new NotFoundError(model);
                }
                const query = kysely
                    .updateTable(fromRelation.model)
                    .where((eb) => eb.and(fromRelation.ids))
                    .set(
                        keyPairs.reduce(
                            (acc, { fk, pk }) => ({
                                ...acc,
                                [fk]: target[pk],
                            }),
                            {} as any,
                        ),
                    )
                    .modifyEnd(
                        this.makeContextComment({
                            model: fromRelation.model,
                            operation: 'update',
                        }),
                    );
                updateResult = await this.executeQuery(kysely, query, 'connect');
            } else {
                // disconnect current if it's a one-one relation
                const relationFieldDef = this.requireField(fromRelation.model, fromRelation.field);

                if (!relationFieldDef.array) {
                    const query = kysely
                        .updateTable(model)
                        .where((eb) => eb.and(keyPairs.map(({ fk, pk }) => eb(sql.ref(fk), '=', fromRelation.ids[pk]))))
                        .set(keyPairs.reduce((acc, { fk }) => ({ ...acc, [fk]: null }), {} as any))
                        .modifyEnd(
                            this.makeContextComment({
                                model: fromRelation.model,
                                operation: 'update',
                            }),
                        );
                    await this.executeQuery(kysely, query, 'disconnect');
                }

                // connect
                const query = kysely
                    .updateTable(model)
                    .where((eb) => eb.or(_data.map((d) => eb.and(d))))
                    .set(
                        keyPairs.reduce(
                            (acc, { fk, pk }) => ({
                                ...acc,
                                [fk]: fromRelation.ids[pk],
                            }),
                            {} as any,
                        ),
                    )
                    .modifyEnd(
                        this.makeContextComment({
                            model,
                            operation: 'update',
                        }),
                    );
                updateResult = await this.executeQuery(kysely, query, 'connect');
            }

            // validate connect result
            if (_data.length > updateResult.numAffectedRows!) {
                // some entities were not connected
                throw new NotFoundError(model);
            }
        }
    }

    protected async connectOrCreateRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext<Schema>,
    ) {
        const _data = enumerate(data);
        if (_data.length === 0) {
            return;
        }

        return Promise.all(
            _data.map(async ({ where, create }) => {
                const existing = await this.exists(kysely, model, where);
                if (existing) {
                    return this.connectRelation(kysely, model, [where], fromRelation);
                } else {
                    return this.create(kysely, model, create, fromRelation);
                }
            }),
        );
    }

    protected async disconnectRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext<Schema>,
    ) {
        let disconnectConditions: any[] = [];
        if (typeof data === 'boolean') {
            if (data === false) {
                return;
            } else {
                disconnectConditions = [true];
            }
        } else {
            disconnectConditions = this.normalizeRelationManipulationInput(model, data);

            if (disconnectConditions.length === 0) {
                return;
            }
        }

        if (disconnectConditions.length === 0) {
            return;
        }

        const m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);
        if (m2m) {
            // handle many-to-many relation
            const actions = disconnectConditions.map(async (d) => {
                const ids = await this.getEntityIds(kysely, model, d);
                if (!ids) {
                    // not found
                    return;
                }
                return this.handleManyToManyRelation(
                    kysely,
                    'disconnect',
                    fromRelation.model,
                    fromRelation.field,
                    fromRelation.ids,
                    m2m.otherModel,
                    m2m.otherField,
                    ids,
                    m2m.joinTable,
                );
            });
            await Promise.all(actions);
        } else {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field,
            );

            const eb = expressionBuilder<any, any>();
            if (ownedByModel) {
                // set parent fk directly
                invariant(disconnectConditions.length === 1, 'only one entity can be disconnected');
                const condition = disconnectConditions[0];
                const query = kysely
                    .updateTable(fromRelation.model)
                    // id filter
                    .where(eb.and(fromRelation.ids))
                    // merge extra disconnect conditions
                    .$if(condition !== true, (qb) =>
                        qb.where(
                            eb(
                                // @ts-ignore
                                eb.refTuple(...keyPairs.map(({ fk }) => fk)),
                                'in',
                                eb
                                    .selectFrom(model)
                                    .select(keyPairs.map(({ pk }) => pk))
                                    .where(this.dialect.buildFilter(eb, model, model, condition)),
                            ),
                        ),
                    )
                    .set(keyPairs.reduce((acc, { fk }) => ({ ...acc, [fk]: null }), {} as any))
                    .modifyEnd(
                        this.makeContextComment({
                            model: fromRelation.model,
                            operation: 'update',
                        }),
                    );
                await this.executeQuery(kysely, query, 'disconnect');
            } else {
                // disconnect
                const query = kysely
                    .updateTable(model)
                    .where(
                        eb.and([
                            // fk filter
                            eb.and(Object.fromEntries(keyPairs.map(({ fk, pk }) => [fk, fromRelation.ids[pk]]))),
                            // merge extra disconnect conditions
                            eb.or(disconnectConditions.map((d) => eb.and(d))),
                        ]),
                    )
                    .set(keyPairs.reduce((acc, { fk }) => ({ ...acc, [fk]: null }), {} as any))
                    .modifyEnd(
                        this.makeContextComment({
                            model,
                            operation: 'update',
                        }),
                    );
                await this.executeQuery(kysely, query, 'disconnect');
            }
        }
    }

    protected async setRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext<Schema>,
    ) {
        const _data = this.normalizeRelationManipulationInput(model, data);

        const m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);

        if (m2m) {
            // handle many-to-many relation

            // reset for the parent
            await this.resetManyToManyRelation(kysely, fromRelation.model, fromRelation.field, fromRelation.ids);

            // connect new entities
            const actions = _data.map(async (d) => {
                const ids = await this.getEntityIds(kysely, model, d);
                return this.handleManyToManyRelation(
                    kysely,
                    'connect',
                    fromRelation.model,
                    fromRelation.field,
                    fromRelation.ids,
                    m2m.otherModel,
                    m2m.otherField,
                    ids,
                    m2m.joinTable,
                );
            });
            const results = await Promise.all(actions);

            // validate connect result
            if (_data.length > results.filter((r) => !!r).length) {
                throw new NotFoundError(model);
            }
        } else {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field,
            );

            if (ownedByModel) {
                throw new InternalError('relation can only be set from the non-owning side');
            }

            const fkConditions = keyPairs.reduce(
                (acc, { fk, pk }) => ({
                    ...acc,
                    [fk]: fromRelation.ids[pk],
                }),
                {} as any,
            );

            // disconnect
            const query = kysely
                .updateTable(model)
                .where((eb) =>
                    eb.and([
                        // match parent
                        eb.and(fkConditions),
                        // exclude entities to be connected
                        eb.not(eb.or(_data.map((d) => eb.and(d)))),
                    ]),
                )
                .set(keyPairs.reduce((acc, { fk }) => ({ ...acc, [fk]: null }), {} as any))
                .modifyEnd(
                    this.makeContextComment({
                        model,
                        operation: 'update',
                    }),
                );
            await this.executeQuery(kysely, query, 'disconnect');

            // connect
            if (_data.length > 0) {
                const query = kysely
                    .updateTable(model)
                    .where((eb) => eb.or(_data.map((d) => eb.and(d))))
                    .set(
                        keyPairs.reduce(
                            (acc, { fk, pk }) => ({
                                ...acc,
                                [fk]: fromRelation.ids[pk],
                            }),
                            {} as any,
                        ),
                    )
                    .modifyEnd(
                        this.makeContextComment({
                            model,
                            operation: 'update',
                        }),
                    );
                const r = await this.executeQuery(kysely, query, 'connect');

                // validate result
                if (_data.length > r.numAffectedRows!) {
                    // some entities were not connected
                    throw new NotFoundError(model);
                }
            }
        }
    }

    protected async deleteRelation(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        data: any,
        fromRelation: FromRelationContext<Schema>,
        throwForNotFound: boolean,
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
            deleteConditions = this.normalizeRelationManipulationInput(model, data);
            if (deleteConditions.length === 0) {
                return;
            }
            expectedDeleteCount = deleteConditions.length;
        }

        let deleteResult: { count: number };
        const m2m = getManyToManyRelation(this.schema, fromRelation.model, fromRelation.field);

        if (m2m) {
            // handle many-to-many relation
            const fieldDef = this.requireField(fromRelation.model, fromRelation.field);
            invariant(fieldDef.relation?.opposite);

            deleteResult = await this.delete(kysely, model, {
                AND: [
                    {
                        [fieldDef.relation.opposite]: {
                            some: fromRelation.ids,
                        },
                    },
                    {
                        OR: deleteConditions,
                    },
                ],
            });
        } else {
            const { ownedByModel, keyPairs } = getRelationForeignKeyFieldPairs(
                this.schema,
                fromRelation.model,
                fromRelation.field,
            );

            if (ownedByModel) {
                const fromEntity = await this.readUnique(kysely, fromRelation.model as GetModels<Schema>, {
                    where: fromRelation.ids,
                });
                if (!fromEntity) {
                    throw new NotFoundError(model);
                }

                const fieldDef = this.requireField(fromRelation.model, fromRelation.field);
                invariant(fieldDef.relation?.opposite);
                deleteResult = await this.delete(kysely, model, {
                    AND: [
                        // filter for parent
                        Object.fromEntries(keyPairs.map(({ fk, pk }) => [pk, fromEntity[fk]])),
                        {
                            OR: deleteConditions,
                        },
                    ],
                });
            } else {
                deleteResult = await this.delete(kysely, model, {
                    AND: [
                        Object.fromEntries(keyPairs.map(({ fk, pk }) => [fk, fromRelation.ids[pk]])),
                        {
                            OR: deleteConditions,
                        },
                    ],
                });
            }
        }

        // validate result
        if (throwForNotFound && expectedDeleteCount > deleteResult.count) {
            // some entities were not deleted
            throw new NotFoundError(model);
        }
    }

    private normalizeRelationManipulationInput(model: GetModels<Schema>, data: any) {
        return enumerate(data).map((item) => flattenCompoundUniqueFilters(this.schema, model, item));
    }

    // #endregion

    protected async delete(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        where: any,
        limit?: number,
        filterModel?: GetModels<Schema>,
    ): Promise<{ count: number }> {
        filterModel ??= model;

        const modelDef = this.requireModel(model);

        if (modelDef.baseModel) {
            if (limit !== undefined) {
                throw new QueryError('Deleting with a limit is not supported for polymorphic models');
            }
            // just delete base and it'll cascade back to this model
            return this.processBaseModelDelete(kysely, modelDef.baseModel, where, limit, filterModel);
        }

        let query = kysely.deleteFrom(model);
        let needIdFilter = false;

        if (limit !== undefined && !this.dialect.supportsDeleteWithLimit) {
            // if the dialect doesn't support delete with limit natively, we'll
            // simulate it by filtering by id with a limit
            needIdFilter = true;
        }

        if (modelDef.isDelegate || modelDef.baseModel) {
            // if the model is in a delegate hierarchy, we'll need to filter by
            // id because the filter may involve fields in different models in
            // the hierarchy
            needIdFilter = true;
        }

        if (!needIdFilter) {
            query = query.where((eb) => this.dialect.buildFilter(eb, model, model, where));
        } else {
            query = query.where((eb) =>
                eb(
                    eb.refTuple(
                        // @ts-expect-error
                        ...this.buildIdFieldRefs(kysely, model),
                    ),
                    'in',
                    this.dialect
                        .buildSelectModel(eb, filterModel)
                        .where((eb) => this.dialect.buildFilter(eb, filterModel, filterModel, where))
                        .select(this.buildIdFieldRefs(kysely, filterModel))
                        .$if(limit !== undefined, (qb) => qb.limit(limit!)),
                ),
            );
        }

        // if the model being deleted has a relation to a model that extends a delegate model, and if that
        // relation is set to trigger a cascade delete from this model, the deletion will not automatically
        // clean up the base hierarchy of the relation side (because polymorphic model's cascade deletion
        // works downward not upward). We need to take care of the base deletions manually here.
        await this.processDelegateRelationDelete(kysely, modelDef, where, limit);

        query = query.modifyEnd(this.makeContextComment({ model, operation: 'delete' }));
        const result = await this.executeQuery(kysely, query, 'delete');
        return { count: Number(result.numAffectedRows) };
    }

    private async processDelegateRelationDelete(
        kysely: ToKysely<Schema>,
        modelDef: ModelDef,
        where: any,
        limit: number | undefined,
    ) {
        for (const fieldDef of Object.values(modelDef.fields)) {
            if (fieldDef.relation && fieldDef.relation.opposite) {
                const oppositeModelDef = this.requireModel(fieldDef.type);
                const oppositeRelation = this.requireField(fieldDef.type, fieldDef.relation.opposite);
                if (oppositeModelDef.baseModel && oppositeRelation.relation?.onDelete === 'Cascade') {
                    if (limit !== undefined) {
                        throw new QueryError('Deleting with a limit is not supported for polymorphic models');
                    }
                    // the deletion will propagate upward to the base model chain
                    await this.delete(
                        kysely,
                        fieldDef.type as GetModels<Schema>,
                        {
                            [fieldDef.relation.opposite]: where,
                        },
                        undefined,
                    );
                }
            }
        }
    }

    private async processBaseModelDelete(
        kysely: ToKysely<Schema>,
        model: string,
        where: any,
        limit: number | undefined,
        filterModel: GetModels<Schema>,
    ) {
        return this.delete(kysely, model as GetModels<Schema>, where, limit, filterModel);
    }

    protected makeIdSelect(model: string) {
        const modelDef = this.requireModel(model);
        return modelDef.idFields.reduce((acc, f) => {
            acc[f] = true;
            return acc;
        }, {} as any);
    }

    protected trimResult(data: any, args: SelectIncludeOmit<Schema, GetModels<Schema>, boolean>) {
        if (!('select' in args) || !args.select) {
            return data;
        }
        return Object.keys(args.select).reduce((acc, field) => {
            acc[field] = data[field];
            return acc;
        }, {} as any);
    }

    protected needReturnRelations(model: string, args: SelectIncludeOmit<Schema, GetModels<Schema>, boolean>) {
        let returnRelation = false;

        if ('include' in args && args.include) {
            returnRelation = Object.keys(args.include).length > 0;
        } else if ('select' in args && args.select) {
            returnRelation = Object.entries(args.select).some(([K, v]) => {
                const fieldDef = this.requireField(model, K);
                return fieldDef.relation && v;
            });
        }
        return returnRelation;
    }

    protected async safeTransaction<T>(
        callback: (tx: ToKysely<Schema>) => Promise<T>,
        isolationLevel?: IsolationLevel,
    ) {
        if (this.kysely.isTransaction) {
            // proceed directly if already in a transaction
            return callback(this.kysely);
        } else {
            // otherwise, create a new transaction and execute the callback
            let txBuilder = this.kysely.transaction();
            txBuilder = txBuilder.setIsolationLevel(isolationLevel ?? 'repeatable read');
            return txBuilder.execute(callback);
        }
    }

    // Given a unique filter of a model, return the entity ids by trying to
    // reused the filter if it's a complete id filter (without extra fields)
    // otherwise, read the entity by the filter
    private getEntityIds(kysely: ToKysely<Schema>, model: GetModels<Schema>, uniqueFilter: any) {
        const idFields: string[] = getIdFields(this.schema, model);
        if (
            // all id fields are provided
            idFields.every((f) => f in uniqueFilter && uniqueFilter[f] !== undefined) &&
            // no non-id filter exists
            Object.keys(uniqueFilter).every((k) => idFields.includes(k))
        ) {
            return uniqueFilter;
        }

        return this.readUnique(kysely, model, {
            where: uniqueFilter,
        });
    }

    /**
     * Normalize input args to strip `undefined` fields
     */
    protected normalizeArgs(args: unknown) {
        if (!args) {
            return;
        }
        const newArgs = clone(args);
        this.doNormalizeArgs(newArgs);
        return newArgs;
    }

    private doNormalizeArgs(args: unknown) {
        if (args && typeof args === 'object') {
            for (const [key, value] of Object.entries(args)) {
                if (value === undefined) {
                    delete args[key as keyof typeof args];
                } else if (value && isPlainObject(value)) {
                    this.doNormalizeArgs(value);
                }
            }
        }
    }

    protected makeQueryId(operation: string) {
        return { queryId: `${operation}-${createId()}` };
    }

    protected executeQuery(kysely: ToKysely<Schema>, query: Compilable, operation: string) {
        return kysely.executeQuery(query.compile(), this.makeQueryId(operation));
    }

    protected async executeQueryTakeFirst(kysely: ToKysely<Schema>, query: Compilable, operation: string) {
        const result = await kysely.executeQuery(query.compile(), this.makeQueryId(operation));
        return result.rows[0];
    }

    protected async executeQueryTakeFirstOrThrow(kysely: ToKysely<Schema>, query: Compilable, operation: string) {
        const result = await kysely.executeQuery(query.compile(), this.makeQueryId(operation));
        if (result.rows.length === 0) {
            throw new QueryError('No rows found');
        }
        return result.rows[0];
    }
}
