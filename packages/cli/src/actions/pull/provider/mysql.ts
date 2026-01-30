import type { BuiltinType } from '@zenstackhq/language/ast';
import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';

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
                return { type: 'varchar', precisition: 191 };
            case 'Boolean':
                return { type: 'tinyint', precisition: 1 };
            case 'Int':
                return { type: 'int' };
            case 'BigInt':
                return { type: 'bigint' };
            case 'Float':
                return { type: 'double' };
            case 'Decimal':
                return { type: 'decimal', precisition: 65 };
            case 'DateTime':
                return { type: 'datetime', precisition: 3 };
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
                throw new Error('Database name not found in connection string');
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
                const sortedColumns = (columns || []).sort(
                    (a: { ordinal_position?: number }, b: { ordinal_position?: number }) =>
                        (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0)
                );

                tables.push({
                    schema: '', // MySQL doesn't support multi-schema
                    name: row.name,
                    type: row.type as 'table' | 'view',
                    definition: row.definition,
                    columns: sortedColumns,
                    indexes: indexes || [],
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
    getDefaultValue({ defaultValue, fieldName, services, enums }) {
        const val = defaultValue.trim();
        const factories: DataFieldAttributeFactory[] = [];

        const defaultAttr = new DataFieldAttributeFactory().setDecl(getAttributeRef('@default', services));

        // Handle CURRENT_TIMESTAMP
        if (val === 'CURRENT_TIMESTAMP' || val === 'current_timestamp()' || val === 'now()') {
            factories.push(defaultAttr.addArg((ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services))));

            if (fieldName.toLowerCase() === 'updatedat' || fieldName.toLowerCase() === 'updated_at') {
                factories.push(new DataFieldAttributeFactory().setDecl(getAttributeRef('@updatedAt', services)));
            }
            return factories;
        }

        // Handle auto_increment
        if (val === 'auto_increment') {
            factories.push(
                defaultAttr.addArg((ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services))),
            );
            return factories;
        }

        // Handle NULL
        if (val.toUpperCase() === 'NULL') {
            return [];
        }

        // Handle boolean values
        if (val === 'true' || val === '1' || val === "b'1'") {
            factories.push(defaultAttr.addArg((ab) => ab.BooleanLiteral.setValue(true)));
            return factories;
        }
        if (val === 'false' || val === '0' || val === "b'0'") {
            factories.push(defaultAttr.addArg((ab) => ab.BooleanLiteral.setValue(false)));
            return factories;
        }

        // Handle numeric values
        if (/^-?\d+$/.test(val) || /^-?\d+(\.\d+)?$/.test(val)) {
            factories.push(defaultAttr.addArg((ab) => ab.NumberLiteral.setValue(val)));
            return factories;
        }

        // Handle string values (quoted with single quotes)
        if (val.startsWith("'") && val.endsWith("'")) {
            const strippedValue = val.slice(1, -1).replace(/''/g, "'");

            // Check if it's an enum value
            const enumDef = enums.find((e) => e.fields.find((v) => getDbName(v) === strippedValue));
            if (enumDef) {
                const enumField = enumDef.fields.find((v) => getDbName(v) === strippedValue);
                if (enumField) {
                    factories.push(defaultAttr.addArg((ab) => ab.ReferenceExpr.setTarget(enumField)));
                    return factories;
                }
            }

            factories.push(defaultAttr.addArg((ab) => ab.StringLiteral.setValue(strippedValue)));
            return factories;
        }

        // Handle function calls (e.g., uuid(), now())
        if (val.includes('(') && val.includes(')')) {
            // Check for known functions
            if (val.toLowerCase() === 'uuid()') {
                factories.push(
                    defaultAttr.addArg((a) => a.InvocationExpr.setFunction(getFunctionRef('uuid', services))),
                );
                return factories;
            }

            // For other functions, use dbgenerated
            factories.push(
                defaultAttr.addArg((a) =>
                    a.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                        a.setValue((v) => v.StringLiteral.setValue(val)),
                    ),
                ),
            );
            return factories;
        }

        // For any other unhandled cases, use dbgenerated
        factories.push(
            defaultAttr.addArg((a) =>
                a.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                    a.setValue((v) => v.StringLiteral.setValue(val)),
                ),
            ),
        );
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
                'datatype', c.DATA_TYPE,
                'length', c.CHARACTER_MAXIMUM_LENGTH,
                'precision', COALESCE(c.NUMERIC_PRECISION, c.DATETIME_PRECISION),
                'nullable', c.IS_NULLABLE = 'YES',
                'default', c.COLUMN_DEFAULT,
                'pk', c.COLUMN_KEY = 'PRI',
                'unique', c.COLUMN_KEY = 'UNI',
                'unique_name', CASE WHEN c.COLUMN_KEY = 'UNI' THEN c.COLUMN_NAME ELSE NULL END,
                'computed', c.GENERATION_EXPRESSION IS NOT NULL AND c.GENERATION_EXPRESSION != '',
                'options', JSON_ARRAY(),
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
    AND t.TABLE_NAME NOT LIKE '_prisma_migrations'
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
