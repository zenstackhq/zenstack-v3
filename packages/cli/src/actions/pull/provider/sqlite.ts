import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { getAttributeRef, getDbName, getFunctionRef, normalizeDecimalDefault, normalizeFloatDefault } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';

// Note: We dynamically import better-sqlite3 inside the async function to avoid
// requiring it at module load time for environments that don't use SQLite.

export const sqlite: IntrospectionProvider = {
    isSupportedFeature(feature) {
        switch (feature) {
            case 'Schema':
                // Multi-schema feature is not available for SQLite because it doesn't have
                // the same concept of schemas as namespaces (unlike PostgreSQL, CockroachDB, SQL Server).
                return false;
            case 'NativeEnum':
                // SQLite doesn't support native enum types
                return false;
            default:
                return false;
        }
    },
    getBuiltinType(type) {
        // Strip parenthesized constraints (e.g., VARCHAR(255) → varchar, DECIMAL(10,2) → decimal)
        const t = (type || '').toLowerCase().trim().replace(/\(.*\)$/, '').trim();
        // SQLite has no array types
        const isArray = false;

        // SQLite type affinity rules (https://www.sqlite.org/datatype3.html):
        // 1. If type contains "INT" → INTEGER affinity
        // 2. If type contains "CHAR", "CLOB", or "TEXT" → TEXT affinity
        // 3. If type contains "BLOB" or no type → BLOB affinity
        // 4. If type contains "REAL", "FLOA", or "DOUB" → REAL affinity
        // 5. Otherwise → NUMERIC affinity

        // Handle specific known types first for better mapping
        switch (t) {
            // INTEGER types (SQLite: INT, INTEGER, TINYINT, SMALLINT, MEDIUMINT, INT2, INT8)
            case 'integer':
            case 'int':
            case 'tinyint':
            case 'smallint':
            case 'mediumint':
            case 'int2':
            case 'int8':
                return { type: 'Int', isArray };

            // BIGINT - map to BigInt for large integers
            case 'bigint':
            case 'unsigned big int':
                return { type: 'BigInt', isArray };

            // TEXT types (SQLite: CHARACTER, VARCHAR, VARYING CHARACTER, NCHAR, NATIVE CHARACTER, NVARCHAR, TEXT, CLOB)
            case 'text':
            case 'varchar':
            case 'char':
            case 'character':
            case 'varying character':
            case 'nchar':
            case 'native character':
            case 'nvarchar':
            case 'clob':
                return { type: 'String', isArray };

            // BLOB type
            case 'blob':
                return { type: 'Bytes', isArray };

            // REAL types (SQLite: REAL, DOUBLE, DOUBLE PRECISION, FLOAT)
            case 'real':
            case 'float':
            case 'double':
            case 'double precision':
                return { type: 'Float', isArray };

            // NUMERIC types (SQLite: NUMERIC, DECIMAL)
            case 'numeric':
            case 'decimal':
                return { type: 'Decimal', isArray };

            // DateTime types
            case 'datetime':
            case 'date':
            case 'time':
            case 'timestamp':
                return { type: 'DateTime', isArray };

            // JSON types
            case 'json':
            case 'jsonb':
                return { type: 'Json', isArray };

            // Boolean types
            case 'boolean':
            case 'bool':
                return { type: 'Boolean', isArray };

            default: {
                // Fallback: Use SQLite affinity rules for unknown types
                if (t.includes('int')) {
                    return { type: 'Int', isArray };
                }
                if (t.includes('char') || t.includes('clob') || t.includes('text')) {
                    return { type: 'String', isArray };
                }
                if (t.includes('blob')) {
                    return { type: 'Bytes', isArray };
                }
                if (t.includes('real') || t.includes('floa') || t.includes('doub')) {
                    return { type: 'Float', isArray };
                }
                // Default to Unsupported for truly unknown types
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

            // List user tables and views from sqlite_schema (the master catalog).
            // sqlite_schema contains one row per table, view, index, and trigger.
            // We filter to only tables/views and exclude internal sqlite_* objects.
            // The 'sql' column contains the original CREATE TABLE/VIEW statement.
            const tablesRaw = all<{ name: string; type: 'table' | 'view'; definition: string | null }>(
                "SELECT name, type, sql AS definition FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            );

            // Detect AUTOINCREMENT by parsing the CREATE TABLE statement
            // The sqlite_sequence table only has entries after rows are inserted,
            // so we need to check the actual table definition instead
            const autoIncrementTables = new Set<string>();
            for (const t of tablesRaw) {
                if (t.type === 'table' && t.definition) {
                    // AUTOINCREMENT keyword appears in PRIMARY KEY definition
                    // e.g., PRIMARY KEY("id" AUTOINCREMENT) or PRIMARY KEY(id AUTOINCREMENT)
                    if (/\bAUTOINCREMENT\b/i.test(t.definition)) {
                        autoIncrementTables.add(t.name);
                    }
                }
            }

            const tables: IntrospectedTable[] = [];

            for (const t of tablesRaw) {
                const tableName = t.name;
                const schema = '';

                // Check if this table has autoincrement (via sqlite_sequence)
                const hasAutoIncrement = autoIncrementTables.has(tableName);

                // PRAGMA table_xinfo: extended version of table_info that also includes hidden/generated columns.
                // Returns one row per column with: cid (column index), name, type, notnull, dflt_value, pk.
                // hidden: 0 = normal column, 1 = hidden/internal (e.g., rowid), 2 = generated/computed column.
                const columnsInfo = all<{
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: string | null;
                    pk: number;
                    hidden?: number;
                }>(`PRAGMA table_xinfo('${tableName.replace(/'/g, "''")}')`);

                // PRAGMA index_list: returns all indexes on a table.
                // Each row has: seq (index sequence), name, unique (1 if unique), origin ('c'=CREATE INDEX,
                // 'u'=UNIQUE constraint, 'pk'=PRIMARY KEY), partial (1 if partial index).
                // We exclude sqlite_autoindex_* entries which are auto-generated for UNIQUE constraints.
                const tableNameEsc = tableName.replace(/'/g, "''");
                const idxList = all<{
                    seq: number;
                    name: string;
                    unique: number;
                    origin: string;
                    partial: number;
                }>(`PRAGMA index_list('${tableNameEsc}')`).filter((r) => !r.name.startsWith('sqlite_autoindex_'));

                // Detect single-column unique constraints by inspecting each unique index.
                // PRAGMA index_info: returns the columns that make up an index.
                // If a unique (non-partial) index has exactly one column, that column is "unique".
                const uniqueSingleColumn = new Set<string>();
                const uniqueIndexRows = idxList.filter((r) => r.unique === 1 && r.partial !== 1);
                for (const idx of uniqueIndexRows) {
                    const idxCols = all<{ name: string }>(`PRAGMA index_info('${idx.name.replace(/'/g, "''")}')`);
                    if (idxCols.length === 1 && idxCols[0]?.name) {
                        uniqueSingleColumn.add(idxCols[0].name);
                    }
                }

                // Build detailed index info for each index.
                // PRAGMA index_info returns one row per column in the index.
                // SQLite doesn't expose access method, predicate, or sort order through PRAGMAs.
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
                        predicate: idx.partial === 1 ? '[partial]' : null, // SQLite does not expose index predicate
                        columns: idxCols.map((col) => ({
                            name: col.name,
                            expression: null,
                            order: null,
                            nulls: null,
                        })),
                    };
                });

                // PRAGMA foreign_key_list: returns all foreign key constraints on a table.
                // Each row represents one column in a FK constraint with: id (FK id, shared by multi-column FKs),
                // seq (column index within the FK), table (referenced table), from (local column),
                // to (referenced column), on_update, on_delete (referential actions).
                const fkRows = all<{
                    id: number;
                    seq: number;
                    table: string;
                    from: string;
                    to: string | null;
                    on_update: any;
                    on_delete: any;
                }>(`PRAGMA foreign_key_list('${tableName.replace(/'/g, "''")}')`);

                // Extract FK constraint names from CREATE TABLE statement
                // Pattern: CONSTRAINT "name" FOREIGN KEY("column") or CONSTRAINT name FOREIGN KEY(column)
                const fkConstraintNames = new Map<string, string>();
                if (t.definition) {
                    // Match: CONSTRAINT "name" FOREIGN KEY("col") or CONSTRAINT name FOREIGN KEY(col)
                    // Use [^"'`]+ for quoted names to capture full identifier including underscores and other chars
                    const fkRegex = /CONSTRAINT\s+(?:["'`]([^"'`]+)["'`]|(\w+))\s+FOREIGN\s+KEY\s*\(\s*(?:["'`]([^"'`]+)["'`]|(\w+))\s*\)/gi;
                    let match;
                    while ((match = fkRegex.exec(t.definition)) !== null) {
                        // match[1] = quoted constraint name, match[2] = unquoted constraint name
                        // match[3] = quoted column name, match[4] = unquoted column name
                        const constraintName = match[1] || match[2];
                        const columnName = match[3] || match[4];
                        if (constraintName && columnName) {
                            fkConstraintNames.set(columnName, constraintName);
                        }
                    }
                }

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
                        foreign_key_name: fkConstraintNames.get(fk.from) ?? null,
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

                    // Determine default value - check for autoincrement
                    // AUTOINCREMENT in SQLite can only be on INTEGER PRIMARY KEY column
                    let defaultValue = c.dflt_value;
                    if (hasAutoIncrement && c.pk) {
                        defaultValue = 'autoincrement';
                    }

                    columns.push({
                        name: c.name,
                        datatype: c.type || '',
                        datatype_name: null, // SQLite doesn't support native enums
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
                        default: defaultValue,
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

    getDefaultValue({ defaultValue, fieldType, services, enums }) { // datatype and datatype_name not used for SQLite
        const val = defaultValue.trim();

        switch (fieldType) {
            case 'DateTime':
                if (val === 'CURRENT_TIMESTAMP' || val === 'now()') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services));
                }
                // Fallback to string literal for other DateTime defaults
                return (ab) => ab.StringLiteral.setValue(val);

            case 'Int':
            case 'BigInt':
                if (val === 'autoincrement') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services));
                }
                return (ab) => ab.NumberLiteral.setValue(val);

            case 'Float':
                return normalizeFloatDefault(val);

            case 'Decimal':
                return normalizeDecimalDefault(val);

            case 'Boolean':
                return (ab) => ab.BooleanLiteral.setValue(val === 'true' || val === '1');
            case 'String':
                if (val.startsWith("'") && val.endsWith("'")) {
                    const strippedName = val.slice(1, -1);
                    const enumDef = enums.find((e) => e.fields.find((v) => getDbName(v) === strippedName));
                    if (enumDef) {
                        const enumField = enumDef.fields.find((v) => getDbName(v) === strippedName);
                        if (enumField) return (ab) => ab.ReferenceExpr.setTarget(enumField);
                    }
                    return (ab) => ab.StringLiteral.setValue(strippedName);
                }
                return (ab) => ab.StringLiteral.setValue(val);
        }

        console.warn(`Unsupported default value type: "${defaultValue}" for field type "${fieldType}". Skipping default value.`);
        return null;
    },

    getFieldAttributes({ fieldName, fieldType, services }) {
        const factories: DataFieldAttributeFactory[] = [];

        // Add @updatedAt for DateTime fields named updatedAt or updated_at
        if (fieldType === 'DateTime' && (fieldName.toLowerCase() === 'updatedat' || fieldName.toLowerCase() === 'updated_at')) {
            factories.push(new DataFieldAttributeFactory().setDecl(getAttributeRef('@updatedAt', services)));
        }

        return factories;
    },
};
