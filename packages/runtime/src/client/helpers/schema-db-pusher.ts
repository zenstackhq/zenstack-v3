import { invariant } from '@zenstackhq/common-helpers';
import { CreateTableBuilder, sql, type ColumnDataType, type OnModifyForeignAction } from 'kysely';
import { match } from 'ts-pattern';
import {
    ExpressionUtils,
    type BuiltinType,
    type CascadeAction,
    type FieldDef,
    type GetModels,
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
                    // console.log('Creating enum:', createEnum.compile().sql);
                    await createEnum.execute();
                }
            }

            for (const model of Object.keys(this.schema.models)) {
                const createTable = this.createModelTable(tx, model as GetModels<Schema>);
                // console.log('Creating table:', createTable.compile().sql);
                await createTable.execute();
            }
        });
    }

    private createModelTable(kysely: ToKysely<Schema>, model: GetModels<Schema>) {
        let table = kysely.schema.createTable(model).ifNotExists();
        const modelDef = requireModel(this.schema, model);
        for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
            if (fieldDef.relation) {
                table = this.addForeignKeyConstraint(table, model, fieldName, fieldDef);
            } else {
                table = this.createModelField(table, fieldName, fieldDef, modelDef);
            }
        }

        table = this.addPrimaryKeyConstraint(table, model, modelDef);
        table = this.addUniqueConstraint(table, modelDef);

        return table;
    }

    private addPrimaryKeyConstraint(
        table: CreateTableBuilder<string, any>,
        model: GetModels<Schema>,
        modelDef: ModelDef,
    ) {
        if (modelDef.idFields.length === 1) {
            if (Object.values(modelDef.fields).some((f) => f.id)) {
                // @id defined at field level
                return table;
            }
        }

        if (modelDef.idFields.length > 0) {
            table = table.addPrimaryKeyConstraint(`pk_${model}`, modelDef.idFields);
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
            } else {
                // multi-field constraint
                table = table.addUniqueConstraint(`unique_${key}`, Object.keys(value));
            }
        }
        return table;
    }

    private createModelField(
        table: CreateTableBuilder<any>,
        fieldName: string,
        fieldDef: FieldDef,
        modelDef: ModelDef,
    ) {
        return table.addColumn(fieldName, this.mapFieldType(fieldDef), (col) => {
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

    private isAutoIncrement(fieldDef: FieldDef) {
        return (
            fieldDef.default &&
            ExpressionUtils.isCall(fieldDef.default) &&
            fieldDef.default.function === 'autoincrement'
        );
    }

    private addForeignKeyConstraint(
        table: CreateTableBuilder<string, any>,
        model: GetModels<Schema>,
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
