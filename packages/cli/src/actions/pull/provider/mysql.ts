import type { Attribute, BuiltinType } from '@zenstackhq/language/ast';
import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';
import { CliError } from '../../../cli-error';

// Note: We dynamically import mysql2 inside the async function to avoid
// requiring it at module load time for environments that don't use MySQL.

export const mysql: IntrospectionProvider = {
    isSupportedFeature(feature) {
        switch (feature) {
            case 'NativeEnum':
                return true;
            case 'Schema':
            default:
                return false;
        }
    },
    getBuiltinType(type) {
        const t = (type || '').toLowerCase().trim();

        // MySQL doesn't have native array types
        const isArray = false;

        switch (t) {
            // integers
            case 'tinyint':
            case 'smallint':
            case 'mediumint':
            case 'int':
            case 'integer':
                return { type: 'Int', isArray };
            case 'bigint':
                return { type: 'BigInt', isArray };

            // decimals and floats
            case 'decimal':
            case 'numeric':
                return { type: 'Decimal', isArray };
            case 'float':
            case 'double':
            case 'real':
                return { type: 'Float', isArray };

            // boolean (MySQL uses TINYINT(1) for boolean)
            case 'boolean':
            case 'bool':
                return { type: 'Boolean', isArray };

            // strings
            case 'char':
            case 'varchar':
            case 'tinytext':
            case 'text':
            case 'mediumtext':
            case 'longtext':
                return { type: 'String', isArray };

            // dates/times
            case 'date':
            case 'time':
            case 'datetime':
            case 'timestamp':
            case 'year':
                return { type: 'DateTime', isArray };

            // binary
            case 'binary':
            case 'varbinary':
            case 'tinyblob':
            case 'blob':
            case 'mediumblob':
            case 'longblob':
                return { type: 'Bytes', isArray };

            // json
            case 'json':
                return { type: 'Json', isArray };

            default:
                // Handle ENUM type - MySQL returns enum values like "enum('val1','val2')"
                if (t.startsWith('enum(')) {
                    return { type: 'String', isArray };
                }
                // Handle SET type
                if (t.startsWith('set(')) {
                    return { type: 'String', isArray };
                }
                return { type: 'Unsupported' as const, isArray };
        }
    },
    getDefaultDatabaseType(type: BuiltinType) {
        switch (type) {
            case 'String':
                return { type: 'varchar', precision: 191 };
            case 'Boolean':
                // Boolean maps to 'boolean' (our synthetic type from tinyint(1))
                // No precision needed since we handle the mapping in the query
                return { type: 'boolean' };
            case 'Int':
                return { type: 'int' };
            case 'BigInt':
                return { type: 'bigint' };
            case 'Float':
                return { type: 'double' };
            case 'Decimal':
                return { type: 'decimal', precision: 65 };
            case 'DateTime':
                return { type: 'datetime', precision: 3 };
            case 'Json':
                return { type: 'json' };
            case 'Bytes':
                return { type: 'longblob' };
        }
    },
    async introspect(connectionString: string): Promise<IntrospectedSchema> {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection(connectionString);

        try {
            // Extract database name from connection string
            const url = new URL(connectionString);
            const databaseName = url.pathname.replace('/', '');

            if (!databaseName) {
                throw new CliError('Database name not found in connection string');
            }

            // Introspect tables
            const [tableRows] = (await connection.execute(getTableIntrospectionQuery(databaseName))) as [
                IntrospectedTable[],
                unknown,
            ];
            const tables: IntrospectedTable[] = [];

            for (const row of tableRows) {
                const columns = typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns;
                const indexes = typeof row.indexes === 'string' ? JSON.parse(row.indexes) : row.indexes;

                // Sort columns by ordinal_position to preserve database column order
                const sortedColumns = (columns || [])
                    .sort(
                        (a: { ordinal_position?: number }, b: { ordinal_position?: number }) =>
                            (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0)
                    )
                    .map((col: { options?: string | string[] | null }) => ({
                        ...col,
                        // Parse enum options from COLUMN_TYPE if present (e.g., "enum('val1','val2')")
                        options:
                            typeof col.options === 'string'
                                ? parseEnumValues(col.options)
                                : col.options ?? [],
                    }));

                // Filter out auto-generated FK indexes (MySQL creates these automatically)
                // Pattern: {Table}_{column}_fkey for single-column FK indexes
                const filteredIndexes = (indexes || []).filter(
                    (idx: { name: string; columns: { name: string }[] }) =>
                        !(idx.columns.length === 1 && idx.name === `${row.name}_${idx.columns[0]?.name}_fkey`)
                );

                tables.push({
                    schema: '', // MySQL doesn't support multi-schema
                    name: row.name,
                    type: row.type as 'table' | 'view',
                    definition: row.definition,
                    columns: sortedColumns,
                    indexes: filteredIndexes,
                });
            }

            // Introspect enums (MySQL stores enum values in column definitions)
            const [enumRows] = (await connection.execute(getEnumIntrospectionQuery(databaseName))) as [
                { table_name: string; column_name: string; column_type: string }[],
                unknown,
            ];

            const enums: IntrospectedEnum[] = enumRows.map((row) => {
                // Parse enum values from column_type like "enum('val1','val2','val3')"
                const values = parseEnumValues(row.column_type);
                return {
                    schema_name: '', // MySQL doesn't support multi-schema
                    // Create a unique enum type name based on table and column
                    enum_type: `${row.table_name}_${row.column_name}`,
                    values,
                };
            });
            return { tables, enums };
        } finally {
            await connection.end();
        }
    },
    getDefaultValue({ defaultValue, fieldType, datatype, datatype_name, services, enums }) {
        const val = defaultValue.trim();

        // Handle NULL early
        if (val.toUpperCase() === 'NULL') {
            return null;
        }

        // Handle enum defaults
        if (datatype === 'enum' && datatype_name) {
            const enumDef = enums.find((e) => getDbName(e) === datatype_name);
            if (enumDef) {
                // Strip quotes from the value (MySQL returns 'value')
                const enumValue = val.startsWith("'") && val.endsWith("'") ? val.slice(1, -1) : val;
                const enumField = enumDef.fields.find((f) => getDbName(f) === enumValue);
                if (enumField) {
                    return (ab) => ab.ReferenceExpr.setTarget(enumField);
                }
            }
        }

        switch (fieldType) {
            case 'DateTime':
                if (/^CURRENT_TIMESTAMP(\(\d*\))?$/i.test(val) || val.toLowerCase() === 'current_timestamp()' || val.toLowerCase() === 'now()') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services));
                }
                // Fallback to string literal for other DateTime defaults
                return (ab) => ab.StringLiteral.setValue(val);

            case 'Int':
            case 'BigInt':
                if (val.toLowerCase() === 'auto_increment') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services));
                }
                return (ab) => ab.NumberLiteral.setValue(val);

            case 'Float':
                return normalizeFloatDefault(val);

            case 'Decimal':
                return normalizeDecimalDefault(val);

            case 'Boolean':
                return (ab) => ab.BooleanLiteral.setValue(val.toLowerCase() === 'true' || val === '1' || val === "b'1'");

            case 'String':
                if (val.toLowerCase() === 'uuid()') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('uuid', services));
                }
                return (ab) => ab.StringLiteral.setValue(val);
        }

        // Handle function calls (e.g., uuid(), now())
        if (val.includes('(') && val.includes(')')) {
            return (ab) =>
                ab.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                    a.setValue((v) => v.StringLiteral.setValue(val)),
                );
        }

        console.warn(`Unsupported default value type: "${defaultValue}" for field type "${fieldType}". Skipping default value.`);
        return null;
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
                (defaultDatabaseType.precision &&
                    defaultDatabaseType.precision !== (length || precision)))
        ) {
            const dbAttrFactory = new DataFieldAttributeFactory().setDecl(dbAttr);
            const sizeValue = length ?? precision;
            if (sizeValue !== undefined && sizeValue !== null) {
                dbAttrFactory.addArg((a) => a.NumberLiteral.setValue(sizeValue));
            }
            factories.push(dbAttrFactory);
        }

        return factories;
    },
};

function getTableIntrospectionQuery(databaseName: string) {
    // Note: We use subqueries with ORDER BY before JSON_ARRAYAGG to ensure ordering
    // since MySQL < 8.0.21 doesn't support ORDER BY inside JSON_ARRAYAGG
    // MySQL doesn't support multi-schema, so we don't include schema in the result
    return `
SELECT
    t.TABLE_NAME AS \`name\`,
    CASE t.TABLE_TYPE
        WHEN 'BASE TABLE' THEN 'table'
        WHEN 'VIEW' THEN 'view'
        ELSE NULL
    END AS \`type\`,
    CASE
        WHEN t.TABLE_TYPE = 'VIEW' THEN v.VIEW_DEFINITION
        ELSE NULL
    END AS \`definition\`,
    (
        SELECT JSON_ARRAYAGG(col_json)
        FROM (
            SELECT JSON_OBJECT(
                'ordinal_position', c.ORDINAL_POSITION,
                'name', c.COLUMN_NAME,
                'datatype', CASE
                    WHEN c.DATA_TYPE = 'tinyint' AND c.COLUMN_TYPE = 'tinyint(1)' THEN 'boolean'
                    ELSE c.DATA_TYPE
                END,
                'datatype_name', CASE
                    WHEN c.DATA_TYPE = 'enum' THEN CONCAT(t.TABLE_NAME, '_', c.COLUMN_NAME)
                    ELSE NULL
                END,
                'datatype_schema', '',
                'length', c.CHARACTER_MAXIMUM_LENGTH,
                'precision', COALESCE(c.NUMERIC_PRECISION, c.DATETIME_PRECISION),
                'nullable', c.IS_NULLABLE = 'YES',
                'default', CASE
                    WHEN c.EXTRA LIKE '%auto_increment%' THEN 'auto_increment'
                    ELSE c.COLUMN_DEFAULT
                END,
                'pk', c.COLUMN_KEY = 'PRI',
                'unique', c.COLUMN_KEY = 'UNI',
                'unique_name', CASE WHEN c.COLUMN_KEY = 'UNI' THEN c.COLUMN_NAME ELSE NULL END,
                'computed', c.GENERATION_EXPRESSION IS NOT NULL AND c.GENERATION_EXPRESSION != '',
                'options', CASE
                    WHEN c.DATA_TYPE = 'enum' THEN c.COLUMN_TYPE
                    ELSE NULL
                END,
                'foreign_key_schema', NULL,
                'foreign_key_table', kcu_fk.REFERENCED_TABLE_NAME,
                'foreign_key_column', kcu_fk.REFERENCED_COLUMN_NAME,
                'foreign_key_name', kcu_fk.CONSTRAINT_NAME,
                'foreign_key_on_update', rc.UPDATE_RULE,
                'foreign_key_on_delete', rc.DELETE_RULE
            ) AS col_json
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu_fk
                ON c.TABLE_SCHEMA = kcu_fk.TABLE_SCHEMA
                AND c.TABLE_NAME = kcu_fk.TABLE_NAME
                AND c.COLUMN_NAME = kcu_fk.COLUMN_NAME
                AND kcu_fk.REFERENCED_TABLE_NAME IS NOT NULL
            LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                ON kcu_fk.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                AND kcu_fk.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
            WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA
                AND c.TABLE_NAME = t.TABLE_NAME
            ORDER BY c.ORDINAL_POSITION
        ) AS cols_ordered
    ) AS \`columns\`,
    (
        SELECT JSON_ARRAYAGG(idx_json)
        FROM (
            SELECT JSON_OBJECT(
                'name', s.INDEX_NAME,
                'method', s.INDEX_TYPE,
                'unique', s.NON_UNIQUE = 0,
                'primary', s.INDEX_NAME = 'PRIMARY',
                'valid', TRUE,
                'ready', TRUE,
                'partial', FALSE,
                'predicate', NULL,
                'columns', (
                    SELECT JSON_ARRAYAGG(idx_col_json)
                    FROM (
                        SELECT JSON_OBJECT(
                            'name', s2.COLUMN_NAME,
                            'expression', NULL,
                            'order', CASE s2.COLLATION WHEN 'A' THEN 'ASC' WHEN 'D' THEN 'DESC' ELSE NULL END,
                            'nulls', NULL
                        ) AS idx_col_json
                        FROM INFORMATION_SCHEMA.STATISTICS s2
                        WHERE s2.TABLE_SCHEMA = s.TABLE_SCHEMA
                            AND s2.TABLE_NAME = s.TABLE_NAME
                            AND s2.INDEX_NAME = s.INDEX_NAME
                        ORDER BY s2.SEQ_IN_INDEX
                    ) AS idx_cols_ordered
                )
            ) AS idx_json
            FROM (
                SELECT DISTINCT INDEX_NAME, INDEX_TYPE, NON_UNIQUE, TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = t.TABLE_SCHEMA AND TABLE_NAME = t.TABLE_NAME
            ) s
        ) AS idxs_ordered
    ) AS \`indexes\`
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN INFORMATION_SCHEMA.VIEWS v
    ON t.TABLE_SCHEMA = v.TABLE_SCHEMA AND t.TABLE_NAME = v.TABLE_NAME
WHERE t.TABLE_SCHEMA = '${databaseName}'
    AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
    AND t.TABLE_NAME <> '_prisma_migrations'
ORDER BY t.TABLE_NAME;
`;
}

function getEnumIntrospectionQuery(databaseName: string) {
    return `
SELECT
    c.TABLE_NAME AS table_name,
    c.COLUMN_NAME AS column_name,
    c.COLUMN_TYPE AS column_type
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = '${databaseName}'
    AND c.DATA_TYPE = 'enum'
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;
`;
}

/**
 * Parse enum values from MySQL COLUMN_TYPE string like "enum('val1','val2','val3')"
 */
function parseEnumValues(columnType: string): string[] {
    // Match the content inside enum(...)
    const match = columnType.match(/^enum\((.+)\)$/i);
    if (!match || !match[1]) return [];

    const valuesString = match[1];
    const values: string[] = [];

    // Parse quoted values, handling escaped quotes
    let current = '';
    let inQuote = false;
    let i = 0;

    while (i < valuesString.length) {
        const char = valuesString[i];

        if (char === "'" && !inQuote) {
            inQuote = true;
            i++;
            continue;
        }

        if (char === "'" && inQuote) {
            // Check for escaped quote ('')
            if (valuesString[i + 1] === "'") {
                current += "'";
                i += 2;
                continue;
            }
            // End of value
            values.push(current);
            current = '';
            inQuote = false;
            i++;
            // Skip comma and any whitespace
            while (i < valuesString.length && (valuesString[i] === ',' || valuesString[i] === ' ')) {
                i++;
            }
            continue;
        }

        if (inQuote) {
            current += char;
        }
        i++;
    }

    return values;
}
