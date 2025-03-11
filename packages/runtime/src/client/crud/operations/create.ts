import { createId } from '@paralleldrive/cuid2';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import * as uuid from 'uuid';
import type { FieldDef, GetModels, ModelDef, SchemaDef } from '../../../schema';
import type { BuiltinType, FieldGenerator } from '../../../schema/schema';
import { clone } from '../../../utils/clone';
import { enumerate } from '../../../utils/enumerate';
import { QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import {
    getIdValues,
    getRelationForeignKeyFieldPairs,
    isForeignKeyField,
    isScalarField,
    requireField,
} from '../../query-utils';
import type { CreateArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class CreateOperationHandler<
    Schema extends SchemaDef
> extends BaseOperationHandler<Schema> {
    private readonly inputValidator: InputValidator<Schema>;

    constructor(
        schema: Schema,
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        options: ClientOptions<Schema>
    ) {
        super(schema, kysely, model, options);
        this.inputValidator = new InputValidator(this.schema);
    }

    async handle(_operation: CrudOperation, args: unknown) {
        // parse args
        const parsedArgs = this.inputValidator.validateCreateArgs(
            this.model,
            args
        );

        // need to use the original args as zod may change the order
        // of fields during parse, and order is critical for query parts
        // like `orderBy`
        return this.runQuery(parsedArgs);
    }

    private async runQuery(args: CreateArgs<Schema, GetModels<Schema>>) {
        const hasRelationCreate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationCreate) {
            // employ a transaction
            try {
                result = await this.kysely
                    .transaction()
                    .setIsolationLevel('repeatable read')
                    .execute(async (trx) => {
                        const createResult = await this.doCreate(
                            trx,
                            this.model,
                            args.data
                        );
                        return this.readUnique(trx, this.model, {
                            select: args.select,
                            include: args.include,
                            where: getIdValues(
                                this.schema,
                                this.model,
                                createResult
                            ),
                        });
                    });
            } catch (err) {
                throw new QueryError(`Error during create: ${err}`);
            }
        } else {
            // simple create
            const createResult = await this.doCreate(
                this.kysely,
                this.model,
                args.data
            );
            if (returnRelations) {
                result = this.readUnique(this.kysely, this.model, {
                    select: args.select,
                    include: args.include,
                    where: getIdValues(this.schema, this.model, createResult),
                });
            } else {
                result = this.trimResult(createResult, args);
            }
        }

        return result;
    }

    private async doCreate(
        kysely: ToKysely<Schema>,
        model: string,
        args: object,
        parentModel?: string,
        parentField?: string,
        parentEntity?: any
    ) {
        const modelDef = this.requireModel(model);
        const result: unknown[] = [];

        let parentFkFields: any = {};
        if (parentModel && parentField && parentEntity) {
            parentFkFields = this.buildFkAssignments(
                parentModel,
                parentField,
                parentEntity
            );
        }

        for (const item of enumerate(args)) {
            const createFields: any = { ...parentFkFields };
            const postCreateRelations: Record<string, object> = {};
            for (const field in item) {
                const fieldDef = this.requireField(model, field);
                if (
                    isScalarField(this.schema, model, field) ||
                    isForeignKeyField(this.schema, model, field)
                ) {
                    createFields[field] = this.dialect.transformPrimitive(
                        (item as any)[field],
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
                            (item as any)[field]
                        );
                        for (
                            let i = 0;
                            i < fieldDef.relation.fields.length;
                            i++
                        ) {
                            createFields[fieldDef.relation.fields[i]!] =
                                fkValues[fieldDef.relation.references[i]!];
                        }
                    } else {
                        const subPayload = (item as any)[field];
                        if (subPayload && typeof subPayload === 'object') {
                            postCreateRelations[field] = subPayload;
                        }
                    }
                }
            }

            const updatedData = this.fillGeneratedValues(
                modelDef,
                createFields
            );
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

            if (Object.keys(postCreateRelations).length === 0) {
                result.push(createdEntity);
            } else {
                const relationPromises = Object.entries(
                    postCreateRelations
                ).map(([field, subPayload]) => {
                    return this.processNoneOwnedRelation(
                        kysely,
                        model,
                        field,
                        subPayload,
                        createdEntity
                    );
                });

                // await relation creation
                await Promise.all(relationPromises);

                result.push(createdEntity);
            }
        }

        if (Array.isArray(args)) {
            return result;
        } else {
            return result[0];
        }
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
                    const created = await this.doCreate(
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
                        const created = await this.doCreate(
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
                        this.doCreate(
                            kysely,
                            relationModel,
                            subPayload,
                            contextModel,
                            relationFieldName,
                            parentEntity
                        )
                    );
                    break;
                }

                case 'connect': {
                    tasks.push(
                        this.connectToEntity<Schema>(
                            kysely,
                            relationModel,
                            subPayload,
                            contextModel,
                            relationFieldName,
                            parentEntity
                        )
                    );
                    break;
                }

                case 'connectOrCreate': {
                    tasks.push(
                        this.exists(
                            kysely,
                            relationModel,
                            subPayload.where
                        ).then((found) =>
                            !found
                                ? this.doCreate(
                                      kysely,
                                      relationModel,
                                      subPayload.create,
                                      contextModel,
                                      relationFieldName,
                                      parentEntity
                                  )
                                : this.connectToEntity(
                                      kysely,
                                      relationModel,
                                      found,
                                      contextModel,
                                      relationFieldName,
                                      parentEntity
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

    private connectToEntity<Schema extends SchemaDef>(
        kysely: ToKysely<Schema>,
        model: string,
        targetEntityUniqueFilter: any,
        parentModel: string,
        parentFieldName: string,
        parentEntity: any
    ) {
        const modelDef = this.requireModel(model);
        const fkAssignments = this.buildFkAssignments(
            parentModel,
            parentFieldName,
            parentEntity
        );

        return Promise.all(
            enumerate(targetEntityUniqueFilter).map(async (itemFilter) => {
                const query = kysely
                    .updateTable(modelDef.dbTable as GetModels<Schema>)
                    .where((eb) => eb.and(itemFilter))
                    .set(fkAssignments);
                await query.execute();
            })
        );
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

    private trimResult(data: any, args: CreateArgs<Schema, GetModels<Schema>>) {
        if (!args.select) {
            return data;
        }
        return Object.keys(args.select).reduce((acc, field) => {
            acc[field] = data[field];
            return acc;
        }, {} as any);
    }

    private needReturnRelations(
        model: string,
        args: CreateArgs<Schema, GetModels<Schema>>
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
