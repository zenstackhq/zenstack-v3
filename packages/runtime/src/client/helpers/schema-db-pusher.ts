import { invariant } from '@zenstackhq/common-helpers';
import { CreateTableBuilder, sql, type ColumnDataType, type OnModifyForeignAction } from 'kysely';
import toposort from 'toposort';
import { match } from 'ts-pattern';
import {
    ExpressionUtils,
    type BuiltinType,
    type CascadeAction,
    type FieldDef,
    type ModelDef,
    type SchemaDef,
} from '../../schema';
import type { ToKysely } from '../query-builder';
import { requireModel } from '../query-utils';

export class SchemaDbPusher<Schema extends SchemaDef> {
    constructor(
        private readonly schema: Schema,
        private readonly kysely: ToKysely<Schema>,
    ) {}

    async push() {
        await this.kysely.transaction().execute(async (tx) => {
            if (this.schema.enums && this.schema.provider.type === 'postgresql') {
                for (const [name, enumDef] of Object.entries(this.schema.enums)) {
                    const createEnum = tx.schema.createType(name).asEnum(Object.values(enumDef));
                    await createEnum.execute();
                }
            }

            // sort models so that target of fk constraints are created first
            const sortedModels = this.sortModels(this.schema.models);
            for (const modelDef of sortedModels) {
                const createTable = this.createModelTable(tx, modelDef);
                await createTable.execute();
            }
        });
    }

    private sortModels(models: Record<string, ModelDef>): ModelDef[] {
        const graph: [ModelDef, ModelDef | undefined][] = [];

        for (const model of Object.values(models)) {
            let added = false;

            if (model.baseModel) {
                // base model should be created before concrete model
                const baseDef = requireModel(this.schema, model.baseModel);
                // edge: concrete model -> base model
                graph.push([model, baseDef]);
                added = true;
            }

            for (const field of Object.values(model.fields)) {
                // relation order
                if (field.relation && field.relation.fields && field.relation.references) {
                    const targetModel = requireModel(this.schema, field.type);
                    // edge: fk side -> target model
                    graph.push([model, targetModel]);
                    added = true;
                }
            }

            if (!added) {
                // no relations, add self to graph to ensure it is included in the result
                graph.push([model, undefined]);
            }
        }

        return toposort(graph)
            .reverse()
            .filter((m) => !!m);
    }

    private createModelTable(kysely: ToKysely<Schema>, modelDef: ModelDef) {
        let table: CreateTableBuilder<string, any> = kysely.schema.createTable(modelDef.name).ifNotExists();

        for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
            if (fieldDef.originModel && !fieldDef.id) {
                // skip non-id fields inherited from base model
                continue;
            }

            if (fieldDef.relation) {
                table = this.addForeignKeyConstraint(table, modelDef.name, fieldName, fieldDef);
            } else if (!this.isComputedField(fieldDef)) {
                table = this.createModelField(table, fieldDef, modelDef);
            }
        }

        if (modelDef.baseModel) {
            // create fk constraint
            const baseModelDef = requireModel(this.schema, modelDef.baseModel);
            table = table.addForeignKeyConstraint(
                `fk_${modelDef.baseModel}_delegate`,
                baseModelDef.idFields,
                modelDef.baseModel,
                baseModelDef.idFields,
                (cb) => cb.onDelete('cascade').onUpdate('cascade'),
            );
        }

        table = this.addPrimaryKeyConstraint(table, modelDef);
        table = this.addUniqueConstraint(table, modelDef);

        return table;
    }

    private isComputedField(fieldDef: FieldDef) {
        return fieldDef.attributes?.some((a) => a.name === '@computed');
    }

    private addPrimaryKeyConstraint(table: CreateTableBuilder<string, any>, modelDef: ModelDef) {
        if (modelDef.idFields.length === 1) {
            if (Object.values(modelDef.fields).some((f) => f.id)) {
                // @id defined at field level
                return table;
            }
        }

        if (modelDef.idFields.length > 0) {
            table = table.addPrimaryKeyConstraint(`pk_${modelDef.name}`, modelDef.idFields);
        }

        return table;
    }

    private addUniqueConstraint(table: CreateTableBuilder<string, any>, modelDef: ModelDef) {
        for (const [key, value] of Object.entries(modelDef.uniqueFields)) {
            invariant(typeof value === 'object', 'expecting an object');
            if ('type' in value) {
                // uni-field constraint, check if it's already defined at field level
                const fieldDef = modelDef.fields[key]!;
                if (fieldDef.unique) {
                    continue;
                }
                table = table.addUniqueConstraint(`unique_${modelDef.name}_${key}`, [key]);
            } else {
                // multi-field constraint
                table = table.addUniqueConstraint(`unique_${modelDef.name}_${key}`, Object.keys(value));
            }
        }
        return table;
    }

    private createModelField(table: CreateTableBuilder<any>, fieldDef: FieldDef, modelDef: ModelDef) {
        return table.addColumn(fieldDef.name, this.mapFieldType(fieldDef), (col) => {
            // @id
            if (fieldDef.id && modelDef.idFields.length === 1) {
                col = col.primaryKey();
            }

            // @default
            if (fieldDef.default !== undefined) {
                if (typeof fieldDef.default === 'object' && 'kind' in fieldDef.default) {
                    if (ExpressionUtils.isCall(fieldDef.default) && fieldDef.default.function === 'now') {
                        col = col.defaultTo(sql`CURRENT_TIMESTAMP`);
                    }
                } else {
                    col = col.defaultTo(fieldDef.default);
                }
            }

            // @unique
            if (fieldDef.unique) {
                col = col.unique();
            }

            // nullable
            if (!fieldDef.optional && !fieldDef.array) {
                col = col.notNull();
            }

            if (this.isAutoIncrement(fieldDef) && this.schema.provider.type === 'sqlite') {
                col = col.autoIncrement();
            }

            return col;
        });
    }

    private mapFieldType(fieldDef: FieldDef) {
        if (this.schema.enums?.[fieldDef.type]) {
            return this.schema.provider.type === 'postgresql' ? sql.ref(fieldDef.type) : 'text';
        }

        if (this.isAutoIncrement(fieldDef) && this.schema.provider.type === 'postgresql') {
            return 'serial';
        }

        if (this.isCustomType(fieldDef.type)) {
            return 'jsonb';
        }

        const type = fieldDef.type as BuiltinType;
        const result = match<BuiltinType, ColumnDataType>(type)
            .with('String', () => 'text')
            .with('Boolean', () => 'boolean')
            .with('Int', () => 'integer')
            .with('Float', () => 'real')
            .with('BigInt', () => 'bigint')
            .with('Decimal', () => 'decimal')
            .with('DateTime', () => 'timestamp')
            .with('Bytes', () => (this.schema.provider.type === 'postgresql' ? 'bytea' : 'blob'))
            .with('Json', () => 'jsonb')
            .otherwise(() => {
                throw new Error(`Unsupported field type: ${type}`);
            });

        if (fieldDef.array) {
            // Kysely doesn't support array type natively
            return sql.raw(`${result}[]`);
        } else {
            return result as ColumnDataType;
        }
    }

    private isCustomType(type: string) {
        return this.schema.typeDefs && Object.values(this.schema.typeDefs).some((def) => def.name === type);
    }

    private isAutoIncrement(fieldDef: FieldDef) {
        return (
            fieldDef.default &&
            ExpressionUtils.isCall(fieldDef.default) &&
            fieldDef.default.function === 'autoincrement'
        );
    }

    private addForeignKeyConstraint(
        table: CreateTableBuilder<string, any>,
        model: string,
        fieldName: string,
        fieldDef: FieldDef,
    ) {
        invariant(fieldDef.relation, 'field must be a relation');

        if (!fieldDef.relation.fields || !fieldDef.relation.references) {
            // not fk side
            return table;
        }

        table = table.addForeignKeyConstraint(
            `fk_${model}_${fieldName}`,
            fieldDef.relation.fields,
            fieldDef.type,
            fieldDef.relation.references,
            (cb) => {
                if (fieldDef.relation?.onDelete) {
                    cb = cb.onDelete(this.mapCascadeAction(fieldDef.relation.onDelete));
                }
                if (fieldDef.relation?.onUpdate) {
                    cb = cb.onUpdate(this.mapCascadeAction(fieldDef.relation.onUpdate));
                }
                return cb;
            },
        );
        return table;
    }

    private mapCascadeAction(action: CascadeAction) {
        return match<CascadeAction, OnModifyForeignAction>(action)
            .with('SetNull', () => 'set null')
            .with('Cascade', () => 'cascade')
            .with('Restrict', () => 'restrict')
            .with('NoAction', () => 'no action')
            .with('SetDefault', () => 'set default')
            .exhaustive();
    }
}
