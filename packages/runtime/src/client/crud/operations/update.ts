import invariant from 'tiny-invariant';
import type { FieldDef, GetModels, SchemaDef } from '../../../schema';
import type { BuiltinType } from '../../../schema/schema';
import { enumerate } from '../../../utils/enumerate';
import { NotFoundError, QueryError } from '../../errors';
import type { ClientOptions } from '../../options';
import type { ToKysely } from '../../query-builder';
import {
    getIdValues,
    isForeignKeyField,
    isScalarField,
    requireField,
} from '../../query-utils';
import type { CreateArgs, SelectInclude, UpdateArgs } from '../../types';
import type { CrudOperation } from '../crud-handler';
import { BaseOperationHandler } from './base';
import { InputValidator } from './validator';

export class UpdateOperationHandler<
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

    async handle(operation: CrudOperation, args: unknown) {
        // parse args
        const parsedArgs = this.inputValidator.validateUpdateArgs(
            this.model,
            args
        );

        // need to use the original args as zod may change the order
        // of fields during parse, and order is critical for query parts
        // like `orderBy`
        return this.runQuery(parsedArgs, operation);
    }

    private async runQuery(
        args: UpdateArgs<Schema, GetModels<Schema>>,
        operation: CrudOperation
    ) {
        const hasRelationUpdate = Object.keys(args.data).some(
            (f) => !!requireField(this.schema, this.model, f).relation
        );

        const returnRelations = this.needReturnRelations(this.model, args);

        let result: any;
        if (hasRelationUpdate) {
            // employ a transaction
            try {
                result = await this.kysely
                    .transaction()
                    .setIsolationLevel('repeatable read')
                    .execute(async (trx) => {
                        const updateResult = await this.doUpdate(
                            trx,
                            this.model,
                            args
                        );
                        return this.readUnique(trx, this.model, {
                            select: args.select,
                            include: args.include,
                            where: getIdValues(
                                this.schema,
                                this.model,
                                updateResult
                            ),
                        });
                    });
            } catch (err) {
                throw new QueryError(`Error during create: ${err}`);
            }
        } else {
            // simple create
            const updateResult = await this.doUpdate(
                this.kysely,
                this.model,
                args
            );
            if (returnRelations) {
                result = await this.readUnique(this.kysely, this.model, {
                    select: args.select,
                    include: args.include,
                    where: getIdValues(this.schema, this.model, updateResult),
                });
            } else {
                result = this.trimResult(updateResult, args);
            }
        }

        return result;
    }

    private async doUpdate(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        args: any,
        parentModel?: string,
        parentField?: string,
        parentEntity?: any
    ) {
        if (!args.data || Object.keys(args.data).length === 0) {
            // update without data, simply return
            return this.readUnique(kysely, model, args);
        }

        const modelDef = this.requireModel(model);

        // let parentFkFields: any = {};
        // if (parentModel && parentField && parentEntity) {
        //     parentFkFields = this.buildFkAssignments(
        //         parentModel,
        //         parentField,
        //         parentEntity
        //     );
        // }

        // const updateFields: any = { ...parentFkFields };
        const updateFields: any = {};
        let thisEntity: any = undefined;

        for (const field in args.data) {
            const fieldDef = this.requireField(model, field);
            if (
                isScalarField(this.schema, model, field) ||
                isForeignKeyField(this.schema, model, field)
            ) {
                updateFields[field] = this.dialect.transformPrimitive(
                    args.data[field],
                    fieldDef.type as BuiltinType
                );
            } else {
                if (!thisEntity) {
                    thisEntity = await this.readUnique(kysely, model, {
                        where: args.where,
                        select: this.makeIdSelect(model),
                    });
                }
                await this.processRelationUpdates(
                    kysely,
                    model,
                    field,
                    fieldDef,
                    thisEntity,
                    args.data[field]
                );
                // if (
                //     fieldDef.relation?.fields &&
                //     fieldDef.relation?.references
                // ) {
                //     const fkValues = await this.processOwnedRelation(
                //         kysely,
                //         fieldDef,
                //         (item as any)[field]
                //     );
                //     for (
                //         let i = 0;
                //         i < fieldDef.relation.fields.length;
                //         i++
                //     ) {
                //         updateFields[fieldDef.relation.fields[i]!] =
                //             fkValues[fieldDef.relation.references[i]!];
                //     }
                // } else {
                //     const subPayload = (item as any)[field];
                //     if (subPayload && typeof subPayload === 'object') {
                //         postCreateRelations[field] = subPayload;
                //     }
                // }
            }
        }

        // const updatedData = this.fillGeneratedValues(
        //     modelDef,
        //     createFields
        // );

        if (Object.keys(updateFields).length === 0) {
            // nothing to update, simply read back
            return thisEntity ?? (await this.readUnique(kysely, model, args));
        } else {
            const query = kysely
                .updateTable(modelDef.dbTable)
                .where((eb) =>
                    this.dialect.buildFilter(
                        eb,
                        model,
                        modelDef.dbTable,
                        args.where
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
                throw new NotFoundError(model);
            }

            return updatedEntity[0];
        }
        // if (Object.keys(postCreateRelations).length === 0) {
        //     result.push(updatedEntity);
        // } else {
        //     const relationPromises = Object.entries(
        //         postCreateRelations
        //     ).map(([field, subPayload]) => {
        //         return this.processNoneOwnedRelation(
        //             kysely,
        //             model,
        //             field,
        //             subPayload,
        //             updatedEntity
        //         );
        //     });

        //     // await relation creation
        //     await Promise.all(relationPromises);

        //     result.push(updatedEntity);
        // }

        // return result;
    }

    private async processRelationUpdates(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>,
        field: string,
        fieldDef: FieldDef,
        parentIds: any,
        args: any
    ) {
        if (!args || typeof args !== 'object') {
            return;
        }

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

                default: {
                    throw new Error('Not implemented yet');
                }
            }
        }

        await Promise.all(tasks);
    }

    private trimResult(
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

    private needReturnRelations(
        model: string,
        args:
            | CreateArgs<Schema, GetModels<Schema>>
            | UpdateArgs<Schema, GetModels<Schema>>
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
