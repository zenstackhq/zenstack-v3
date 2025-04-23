import {
    CreateTableBuilder,
    sql,
    type ColumnDataType,
    type OnModifyForeignAction,
} from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { FieldDef, ModelDef, SchemaDef } from '../../schema';
import type {
    BuiltinType,
    CascadeAction,
    GetModels,
} from '../../schema/schema';
import type { ToKysely } from '../query-builder';
import { requireModel } from '../query-utils';

export class SchemaDbPusher<Schema extends SchemaDef> {
    constructor(
        private readonly schema: Schema,
        private readonly kysely: ToKysely<Schema>
    ) {}

    async push() {
        await this.kysely.transaction().execute(async (tx) => {
            if (
                this.schema.enums &&
                this.schema.provider.type === 'postgresql'
            ) {
                for (const [name, enumDef] of Object.entries(
                    this.schema.enums
                )) {
                    const createEnum = tx.schema
                        .createType(name)
                        .asEnum(Object.values(enumDef));
                    // console.log('Creating enum:', createEnum.compile().sql);
                    await createEnum.execute();
                }
            }

            for (const model of Object.keys(this.schema.models)) {
                const createTable = this.createModelTable(
                    tx,
                    model as GetModels<Schema>
                );
                // console.log('Creating table:', createTable.compile().sql);
                await createTable.execute();
            }
        });
    }

    private createModelTable(
        kysely: ToKysely<Schema>,
        model: GetModels<Schema>
    ) {
        let table = kysely.schema.createTable(model).ifNotExists();
        const modelDef = requireModel(this.schema, model);
        for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
            if (fieldDef.relation) {
                table = this.addForeignKeyConstraint(
                    table,
                    model,
                    fieldName,
                    fieldDef
                );
            } else {
                table = this.createModelField(table, fieldName, fieldDef);
            }
        }

        table = this.addPrimaryKeyConstraint(table, model, modelDef);
        table = this.addUniqueConstraint(table, modelDef);

        return table;
    }

    private addPrimaryKeyConstraint(
        table: CreateTableBuilder<string, any>,
        model: GetModels<Schema>,
        modelDef: ModelDef
    ) {
        if (modelDef.idFields.length === 1) {
            if (Object.values(modelDef.fields).some((f) => f.id)) {
                // @id defined at field level
                return table;
            }
        }

        if (modelDef.idFields.length > 0) {
            table = table.addPrimaryKeyConstraint(
                `pk_${model}`,
                modelDef.idFields
            );
        }

        return table;
    }

    private addUniqueConstraint(
        table: CreateTableBuilder<string, any>,
        modelDef: ModelDef
    ) {
        for (const [key, value] of Object.entries(modelDef.uniqueFields)) {
            invariant(typeof value === 'object');
            if ('type' in value) {
                // uni-field constraint, check if it's already defined at field level
                const fieldDef = modelDef.fields[key]!;
                if (fieldDef.unique) {
                    continue;
                }
            } else {
                // multi-field constraint
                table = table.addUniqueConstraint(
                    `unique_${key}`,
                    Object.keys(value)
                );
            }
        }
        return table;
    }

    private createModelField(
        table: CreateTableBuilder<any>,
        fieldName: string,
        fieldDef: FieldDef
    ) {
        return table.addColumn(
            fieldName,
            this.mapFieldType(fieldDef),
            (col) => {
                // @id
                if (fieldDef.id) {
                    col = col.primaryKey();
                }

                // @default
                if (fieldDef.default !== undefined) {
                    if (
                        typeof fieldDef.default === 'object' &&
                        'call' in fieldDef.default
                    ) {
                        if (fieldDef.default.call === 'now') {
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
                if (!fieldDef.optional) {
                    col = col.notNull();
                }

                return col;
            }
        );
    }

    private mapFieldType(fieldDef: FieldDef) {
        if (this.schema.enums?.[fieldDef.type]) {
            return this.schema.provider.type === 'postgresql'
                ? sql.ref(fieldDef.type)
                : 'text';
        }

        const type = fieldDef.type as BuiltinType;
        let result = match(type)
            .with('String', () => 'text')
            .with('Boolean', () => 'boolean')
            .with('Int', () => 'integer')
            .with('Float', () => 'real')
            .with('BigInt', () => 'bigint')
            .with('Decimal', () => 'decimal')
            .with('DateTime', () => 'timestamp')
            .otherwise(() => {
                throw new Error(`Unsupported field type: ${type}`);
            });
        if (fieldDef.array) {
            result = `${result}[]`;
        }
        return result as ColumnDataType;
    }

    private addForeignKeyConstraint(
        table: CreateTableBuilder<string, any>,
        model: GetModels<Schema>,
        fieldName: string,
        fieldDef: FieldDef
    ) {
        invariant(fieldDef.relation);

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
                    cb = cb.onDelete(
                        this.mapCascadeAction(fieldDef.relation.onDelete)
                    );
                }
                if (fieldDef.relation?.onUpdate) {
                    cb = cb.onUpdate(
                        this.mapCascadeAction(fieldDef.relation.onUpdate)
                    );
                }
                return cb;
            }
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
