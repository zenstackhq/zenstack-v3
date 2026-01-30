import type { Attribute, BuiltinType } from '@zenstackhq/language/ast';
import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
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
                }>(`PRAGMA index_list('${tableNameEsc}')`).filter((r) => !r.name.startsWith('sqlite_autoindex_'));

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
                }).reverse(); // Reverse to maintain creation order

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

    getDefaultValue({ defaultValue, fieldType, services, enums }) {
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
                if (/^-?\d+$/.test(val)) {
                    return (ab) => ab.NumberLiteral.setValue(val);
                }
                break;

            case 'Float':
                if (/^-?\d+\.\d+$/.test(val)) {
                    const numVal = parseFloat(val);
                    return (ab) => ab.NumberLiteral.setValue(numVal === Math.floor(numVal) ? numVal.toFixed(1) : String(numVal));
                }
                if (/^-?\d+$/.test(val)) {
                    return (ab) => ab.NumberLiteral.setValue(val + '.0');
                }
                break;

            case 'Decimal':
                if (/^-?\d+\.\d+$/.test(val)) {
                    const numVal = parseFloat(val);
                    if (numVal === Math.floor(numVal)) {
                        return (ab) => ab.NumberLiteral.setValue(numVal.toFixed(2));
                    }
                    return (ab) => ab.NumberLiteral.setValue(String(numVal));
                }
                if (/^-?\d+$/.test(val)) {
                    return (ab) => ab.NumberLiteral.setValue(val + '.00');
                }
                break;

            case 'Boolean':
                if (val === 'true' || val === '1') {
                    return (ab) => ab.BooleanLiteral.setValue(true);
                }
                if (val === 'false' || val === '0') {
                    return (ab) => ab.BooleanLiteral.setValue(false);
                }
                break;

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
                break;
        }

        // Fallback handlers for values that don't match field type-specific patterns
        if (val === 'CURRENT_TIMESTAMP' || val === 'now()') {
            return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services));
        }

        if (val === 'autoincrement') {
            return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services));
        }

        if (val === 'true' || val === 'false') {
            return (ab) => ab.BooleanLiteral.setValue(val === 'true');
        }

        if (/^-?\d+\.\d+$/.test(val) || /^-?\d+$/.test(val)) {
            return (ab) => ab.NumberLiteral.setValue(val);
        }

        if (val.startsWith("'") && val.endsWith("'")) {
            const strippedName = val.slice(1, -1);
            const enumDef = enums.find((e) => e.fields.find((v) => getDbName(v) === strippedName));
            if (enumDef) {
                const enumField = enumDef.fields.find((v) => getDbName(v) === strippedName);
                if (enumField) return (ab) => ab.ReferenceExpr.setTarget(enumField);
            }
            return (ab) => ab.StringLiteral.setValue(strippedName);
        }

        //TODO: add more default value factories if exists
        throw new Error(
            `This default value type currently is not supported. Please open an issue on github. Values: "${defaultValue}"`,
        );
    },

    getFieldAttributes({ fieldName, fieldType, datatype, length, precision, services }) {
        const factories: DataFieldAttributeFactory[] = [];

        // Add @updatedAt for DateTime fields named updatedAt or updated_at
        if (fieldType === 'DateTime' && (fieldName.toLowerCase() === 'updatedat' || fieldName.toLowerCase() === 'updated_at')) {
            factories.push(new DataFieldAttributeFactory().setDecl(getAttributeRef('@updatedAt', services)));
        }

        // Add @db.* attribute if the datatype differs from the default
        const dbAttr = services.shared.workspace.IndexManager.allElements('Attribute').find(
            (d) => d.name.toLowerCase() === `@db.${datatype.toLowerCase()}`,
        )?.node as Attribute | undefined;

        const defaultDatabaseType = this.getDefaultDatabaseType(fieldType as BuiltinType);

        if (
            dbAttr &&
            defaultDatabaseType &&
            (defaultDatabaseType.type !== datatype ||
                (defaultDatabaseType.precisition &&
                    defaultDatabaseType.precisition !== (length || precision)))
        ) {
            const dbAttrFactory = new DataFieldAttributeFactory().setDecl(dbAttr);
            if (length || precision) {
                dbAttrFactory.addArg((a) => a.NumberLiteral.setValue(length! || precision!));
            }
            factories.push(dbAttrFactory);
        }

        return factories;
    },
};
