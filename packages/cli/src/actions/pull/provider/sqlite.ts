import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';

// Note: We dynamically import better-sqlite3 inside the async function to avoid
// requiring it at module load time for environments that don't use SQLite.

export const sqlite: IntrospectionProvider = {
    isSupportedFeature(feature) {
        switch (feature) {
            case 'Schema':
            case 'NativeEnum':
            default:
                return false;
        }
    },
    getBuiltinType(type) {
        const t = (type || '').toLowerCase().trim();
        // SQLite has no array types
        const isArray = false;
        switch (t) {
            case 'integer':
                return { type: 'Int', isArray };
            case 'text':
                return { type: 'String', isArray };
            case 'bigint':
                return { type: 'BigInt', isArray };
            case 'blob':
                return { type: 'Bytes', isArray };
            case 'real':
                return { type: 'Float', isArray };
            case 'numeric':
            case 'decimal':
                return { type: 'Decimal', isArray };
            case 'datetime':
                return { type: 'DateTime', isArray };
            case 'jsonb':
                return { type: 'Json', isArray };
            case 'boolean':
                return { type: 'Boolean', isArray };
            default: {
                return { type: 'Unsupported' as const, isArray };
            }
        }
    },

    getDefaultDatabaseType() {
        return undefined;
    },

    async introspect(connectionString: string): Promise<IntrospectedSchema> {
        const SQLite = (await import('better-sqlite3')).default;
        const db = new SQLite(connectionString, { readonly: true });

        try {
            const all = <T>(sql: string): T[] => {
                const stmt: any = db.prepare(sql);
                return stmt.all() as T[];
            };

            // List user tables and views (exclude internal sqlite_*)
            const tablesRaw = all<{ name: string; type: 'table' | 'view'; definition: string | null }>(
                "SELECT name, type, sql AS definition FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            );

            const tables: IntrospectedTable[] = [];

            for (const t of tablesRaw) {
                const tableName = t.name;
                const schema = '';

                // Columns with extended info; filter out hidden=1 (internal/rowid), mark computed if hidden=2 (generated)
                const columnsInfo = all<{
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: string | null;
                    pk: number;
                    hidden?: number;
                }>(`PRAGMA table_xinfo('${tableName.replace(/'/g, "''")}')`);

                // Index list (used for both unique inference and index collection)
                const tableNameEsc = tableName.replace(/'/g, "''");
                const idxList = all<{
                    seq: number;
                    name: string;
                    unique: number;
                    origin: string;
                    partial: number;
                }>(`PRAGMA index_list('${tableNameEsc}')`);

                // Unique columns detection via unique indexes with single column
                const uniqueSingleColumn = new Set<string>();
                const uniqueIndexRows = idxList.filter((r) => r.unique === 1);
                for (const idx of uniqueIndexRows) {
                    const idxCols = all<{ name: string }>(`PRAGMA index_info('${idx.name.replace(/'/g, "''")}')`);
                    if (idxCols.length === 1 && idxCols[0]?.name) {
                        uniqueSingleColumn.add(idxCols[0].name);
                    }
                }

                // Indexes details
                const indexes: IntrospectedTable['indexes'] = idxList.map((idx) => {
                    const idxCols = all<{ name: string }>(`PRAGMA index_info('${idx.name.replace(/'/g, "''")}')`);
                    return {
                        name: idx.name,
                        method: null, // SQLite does not expose index method
                        unique: idx.unique === 1,
                        primary: false, // SQLite does not expose this directly; handled via pk in columns
                        valid: true, // SQLite does not expose index validity
                        ready: true, // SQLite does not expose index readiness
                        partial: idx.partial === 1,
                        predicate: null, // SQLite does not expose index predicate
                        columns: idxCols.map((col) => ({
                            name: col.name,
                            expression: null,
                            order: null,
                            nulls: null,
                        })),
                    };
                });

                // Foreign keys mapping by column name
                const fkRows = all<{
                    id: number;
                    seq: number;
                    table: string;
                    from: string;
                    to: string | null;
                    on_update: any;
                    on_delete: any;
                }>(`PRAGMA foreign_key_list('${tableName.replace(/'/g, "''")}')`);

                const fkByColumn = new Map<
                    string,
                    {
                        foreign_key_schema: string | null;
                        foreign_key_table: string | null;
                        foreign_key_column: string | null;
                        foreign_key_name: string | null;
                        foreign_key_on_update: IntrospectedTable['columns'][number]['foreign_key_on_update'];
                        foreign_key_on_delete: IntrospectedTable['columns'][number]['foreign_key_on_delete'];
                    }
                >();

                for (const fk of fkRows) {
                    fkByColumn.set(fk.from, {
                        foreign_key_schema: '',
                        foreign_key_table: fk.table || null,
                        foreign_key_column: fk.to || null,
                        foreign_key_name: null,
                        foreign_key_on_update: (fk.on_update as any) ?? null,
                        foreign_key_on_delete: (fk.on_delete as any) ?? null,
                    });
                }

                const columns: IntrospectedTable['columns'] = [];
                for (const c of columnsInfo) {
                    // hidden: 1 (hidden/internal) -> skip; 2 (generated) -> mark computed
                    const hidden = c.hidden ?? 0;
                    if (hidden === 1) continue;

                    const fk = fkByColumn.get(c.name);

                    columns.push({
                        name: c.name,
                        datatype: c.type || '',
                        length: null,
                        precision: null,
                        datatype_schema: schema,
                        foreign_key_schema: fk?.foreign_key_schema ?? null,
                        foreign_key_table: fk?.foreign_key_table ?? null,
                        foreign_key_column: fk?.foreign_key_column ?? null,
                        foreign_key_name: fk?.foreign_key_name ?? null,
                        foreign_key_on_update: fk?.foreign_key_on_update ?? null,
                        foreign_key_on_delete: fk?.foreign_key_on_delete ?? null,
                        pk: !!c.pk,
                        computed: hidden === 2,
                        nullable: c.notnull !== 1,
                        default: c.dflt_value,
                        options: [],
                        unique: uniqueSingleColumn.has(c.name),
                        unique_name: null,
                    });
                }

                tables.push({ schema, name: tableName, columns, type: t.type, definition: t.definition, indexes });
            }

            const enums: IntrospectedEnum[] = []; // SQLite doesn't support enums

            return { tables, enums };
        } finally {
            db.close();
        }
    },

    getDefaultValue({ defaultValue, fieldName, services, enums }) {
        const val = defaultValue.trim();
        const factories: DataFieldAttributeFactory[] = [];

        const defaultAttr = new DataFieldAttributeFactory().setDecl(getAttributeRef('@default', services));

        if (val === 'CURRENT_TIMESTAMP' || val === 'now()') {
            factories.push(defaultAttr.addArg((ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services))));

            if (fieldName.toLowerCase() === 'updatedat' || fieldName.toLowerCase() === 'updated_at') {
                factories.push(new DataFieldAttributeFactory().setDecl(getAttributeRef('@updatedAt', services)));
            }
            return factories;
        }

        if (val === 'true' || val === 'false') {
            factories.push(defaultAttr.addArg((a) => a.BooleanLiteral.setValue(val === 'true')));
            return factories;
        }

        if (!Number.isNaN(parseFloat(val)) || !Number.isNaN(parseInt(val))) {
            factories.push(defaultAttr.addArg((a) => a.NumberLiteral.setValue(val)));
            return factories;
        }

        if (val.startsWith("'") && val.endsWith("'")) {
            const strippedName = val.slice(1, -1);
            const enumDef = enums.find((e) => e.fields.find((v) => getDbName(v) === strippedName));
            if (enumDef) {
                const enumField = enumDef.fields.find((v) => getDbName(v) === strippedName);
                if (enumField) factories.push(defaultAttr.addArg((ab) => ab.ReferenceExpr.setTarget(enumField)));
            } else {
                factories.push(defaultAttr.addArg((a) => a.StringLiteral.setValue(strippedName)));
            }
            return factories;
        }

        //TODO: add more default value factories if exists
        throw new Error(
            `This default value type currently is not supported. Plesase open an issue on github. Values: "${defaultValue}"`,
        );
    },
};
