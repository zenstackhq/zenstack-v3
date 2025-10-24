import type { BuiltinType } from '@zenstackhq/language/ast';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';

// Note: We dynamically import better-sqlite3 inside the async function to avoid
// requiring it at module load time for environments that don't use SQLite.

export const sqlite: IntrospectionProvider = {
    getBuiltinType(type) {
        const t = (type || '').toLowerCase().trim();

        // SQLite has no array types
        const isArray = false;

        switch (t) {
            // integers
            case 'int':
            case 'integer':
            case 'tinyint':
            case 'smallint':
            case 'mediumint':
                return { type: 'Int', isArray };
            case 'bigint':
                return { type: 'BigInt', isArray };

            // decimals and floats
            case 'numeric':
            case 'decimal':
                return { type: 'Decimal', isArray };
            case 'real':
            case 'double':
            case 'double precision':
            case 'float':
                return { type: 'Float', isArray };

            // boolean (SQLite stores as integer 0/1, but commonly typed as BOOLEAN)
            case 'bool':
            case 'boolean':
                return { type: 'Boolean', isArray };

            // strings
            case 'text':
            case 'varchar':
            case 'character varying':
            case 'char':
            case 'character':
            case 'clob':
            case 'uuid': // often stored as TEXT
                return { type: 'String', isArray };

            // dates/times (stored as TEXT/REAL/INTEGER, but commonly typed as DATE/DATETIME)
            case 'date':
            case 'datetime':
                return { type: 'DateTime', isArray };

            // binary
            case 'blob':
                return { type: 'Bytes', isArray };

            // json (not a native type, but commonly used)
            case 'json':
                return { type: 'Json', isArray };

            default: {
                // Fallbacks based on SQLite type affinity rules
                if (t.includes('int')) return { type: 'Int', isArray };
                if (t.includes('char') || t.includes('clob') || t.includes('text')) return { type: 'String', isArray };
                if (t.includes('blob')) return { type: 'Bytes', isArray };
                if (t.includes('real') || t.includes('floa') || t.includes('doub')) return { type: 'Float', isArray };
                if (t.includes('dec') || t.includes('num')) return { type: 'Decimal', isArray };
                return { type: 'Unsupported' as const, isArray };
            }
        }
    },

    getDefaultDatabaseType(type: BuiltinType) {
        switch (type) {
            case 'String':
                return { type: 'TEXT' };
            case 'Boolean':
                return { type: 'INTEGER' };
            case 'Int':
                return { type: 'INTEGER' };
            case 'BigInt':
                return { type: 'INTEGER' };
            case 'Float':
                return { type: 'REAL' };
            case 'Decimal':
                return { type: 'DECIMAL' };
            case 'DateTime':
                return { type: 'NUMERIC' };
            case 'Json':
                return { type: 'JSONB' };
            case 'Bytes':
                return { type: 'BLOB' };
        }
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
                const schema = 'main';

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
                        foreign_key_schema: 'main',
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
                        unique_name: uniqueSingleColumn.has(c.name) ? `${tableName}_${c.name}_unique` : null,
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

    getDefaultValue(_args) {
        throw new Error('Not implemented yet for SQLite');
    },
};
