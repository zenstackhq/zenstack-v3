import {
    CreateTableBuilder,
    sql,
    type ColumnDataType,
    type OnModifyForeignAction,
} from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { FieldDef, ModelDef, SchemaDef } from '../../schema';
import type { BuiltinType, CascadeAction } from '../../schema/schema';
import type { ToKysely } from '../query-builder';
import { requireModel } from '../query-utils';

export class SchemaDbPusher<Schema extends SchemaDef> {
    constructor(
        private readonly schema: Schema,
        private readonly kysely: ToKysely<Schema>
    ) {}

    async push() {
        await this.kysely.transaction().execute(async (trx) => {
            if (
                this.schema.enums &&
                this.schema.provider.type === 'postgresql'
            ) {
                for (const [name, enumDef] of Object.entries(
                    this.schema.enums
                )) {
                    const createEnum = trx.schema
                        .createType(name)
                        .asEnum(Object.values(enumDef));
                    console.log('Creating enum:', createEnum.compile().sql);
                    await createEnum.execute();
                }
            }

            for (const modelDef of Object.values(this.schema.models)) {
                const createTable = this.createModelTable(trx, modelDef);
                console.log('Creating table:', createTable.compile().sql);
                await createTable.execute();
            }
        });
    }

    private createModelTable(kysely: ToKysely<Schema>, modelDef: ModelDef) {
        let table = kysely.schema.createTable(modelDef.dbTable).ifNotExists();

        for (const [fieldName, fieldDef] of Object.entries(modelDef.fields)) {
            if (fieldDef.relation) {
                table = this.addForeignKeyConstraint(
                    table,
                    modelDef,
                    fieldName,
                    fieldDef
                );
            } else {
                table = this.createModelField(table, fieldName, fieldDef);
            }
        }

        table = this.addPrimaryKeyConstraint(table, modelDef);
        table = this.addUniqueConstraint(table, modelDef);

        return table;
    }

    private addPrimaryKeyConstraint(
        table: CreateTableBuilder<string, any>,
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
                `pk_${modelDef.dbTable}`,
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
        modelDef: ModelDef,
        fieldName: string,
        fieldDef: FieldDef
    ) {
        invariant(fieldDef.relation);

        if (!fieldDef.relation.fields || !fieldDef.relation.references) {
            // not fk side
            return table;
        }

        const relationModelDef = requireModel(this.schema, fieldDef.type);

        table = table.addForeignKeyConstraint(
            `fk_${modelDef.dbTable}_${fieldName}`,
            fieldDef.relation.fields,
            relationModelDef.dbTable,
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
