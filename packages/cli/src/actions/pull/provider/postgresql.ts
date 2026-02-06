import type { Attribute, BuiltinType, Enum, Expression } from '@zenstackhq/language/ast';
import { AstFactory, DataFieldAttributeFactory, ExpressionBuilder } from '@zenstackhq/language/factory';
import { Client } from 'pg';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';
import type { ZModelServices } from '@zenstackhq/language';
import { CliError } from '../../../cli-error';

/**
 * Maps PostgreSQL internal type names to their standard SQL names for comparison.
 * This is used to normalize type names when checking against default database types.
 */
const pgTypnameToStandard: Record<string, string> = {
    int2: 'smallint',
    int4: 'integer',
    int8: 'bigint',
    float4: 'real',
    float8: 'double precision',
    bool: 'boolean',
    bpchar: 'character',
    numeric: 'decimal',
};

/**
 * Standard bit widths for integer/float types that shouldn't be added as precision arguments.
 * PostgreSQL returns these as precision values, but they're implicit for the type.
 */
const standardTypePrecisions: Record<string, number> = {
    int2: 16,
    smallint: 16,
    int4: 32,
    integer: 32,
    int8: 64,
    bigint: 64,
    float4: 24,
    real: 24,
    float8: 53,
    'double precision': 53,
};

/**
 * Maps PostgreSQL typnames (from pg_type.typname) to Prisma native type attribute names.
 * PostgreSQL introspection returns internal type names like 'int2', 'int4', 'float8', 'bpchar',
 * but Prisma/ZenStack attributes are named @db.SmallInt, @db.Integer, @db.DoublePrecision, @db.Char, etc.
 */
const pgTypnameToPrismaNativeType: Record<string, string> = {
    // integers
    int2: 'SmallInt',
    smallint: 'SmallInt',
    int4: 'Integer',
    integer: 'Integer',
    int8: 'BigInt',
    bigint: 'BigInt',

    // decimals and floats
    numeric: 'Decimal',
    decimal: 'Decimal',
    float4: 'Real',
    real: 'Real',
    float8: 'DoublePrecision',
    'double precision': 'DoublePrecision',

    // boolean
    bool: 'Boolean',
    boolean: 'Boolean',

    // strings
    text: 'Text',
    varchar: 'VarChar',
    'character varying': 'VarChar',
    bpchar: 'Char',
    character: 'Char',

    // uuid
    uuid: 'Uuid',

    // dates/times
    date: 'Date',
    time: 'Time',
    timetz: 'Timetz',
    timestamp: 'Timestamp',
    timestamptz: 'Timestamptz',

    // binary
    bytea: 'ByteA',

    // json
    json: 'Json',
    jsonb: 'JsonB',

    // xml
    xml: 'Xml',

    // network types
    inet: 'Inet',

    // bit strings
    bit: 'Bit',
    varbit: 'VarBit',

    // oid
    oid: 'Oid',

    // money
    money: 'Money',

    // citext extension
    citext: 'Citext',
};

export const postgresql: IntrospectionProvider = {
    isSupportedFeature(feature) {
      const supportedFeatures = ['Schema', 'NativeEnum'];
      return supportedFeatures.includes(feature);
    },
    getBuiltinType(type) {
        const t = (type || '').toLowerCase();

        const isArray = t.startsWith('_');

        switch (t.replace(/^_/, '')) {
            // integers
            case 'int2':
            case 'smallint':
            case 'int4':
            case 'integer':
                return { type: 'Int', isArray };
            case 'int8':
            case 'bigint':
                return { type: 'BigInt', isArray };

            // decimals and floats
            case 'numeric':
            case 'decimal':
                return { type: 'Decimal', isArray };
            case 'float4':
            case 'real':
            case 'float8':
            case 'double precision':
                return { type: 'Float', isArray };

            // boolean
            case 'bool':
            case 'boolean':
                return { type: 'Boolean', isArray };

            // strings
            case 'text':
            case 'varchar':
            case 'bpchar':
            case 'character varying':
            case 'character':
                return { type: 'String', isArray };

            // uuid
            case 'uuid':
                return { type: 'String', isArray };

            // dates/times
            case 'date':
            case 'time':
            case 'timetz':
            case 'timestamp':
            case 'timestamptz':
                return { type: 'DateTime', isArray };

            // binary
            case 'bytea':
                return { type: 'Bytes', isArray };

            // json
            case 'json':
            case 'jsonb':
                return { type: 'Json', isArray };
            default:
                return { type: 'Unsupported' as const, isArray };
        }
    },
    async introspect(connectionString: string, options: { schemas: string[] }): Promise<IntrospectedSchema> {
        const client = new Client({ connectionString });
        await client.connect();

        try {
            const { rows: tables } = await client.query<IntrospectedTable>(tableIntrospectionQuery);
            const { rows: enums } = await client.query<IntrospectedEnum>(enumIntrospectionQuery);

            // Filter tables and enums to only include those from the selected schemas
            const filteredTables = tables.filter((t) => options.schemas.includes(t.schema));
            const filteredEnums = enums.filter((e) => options.schemas.includes(e.schema_name));

            return {
                enums: filteredEnums,
                tables: filteredTables,
            };
        } finally {
            await client.end();
        }
    },
    getDefaultDatabaseType(type: BuiltinType) {
        switch (type) {
            case 'String':
                return { type: 'text' };
            case 'Boolean':
                return { type: 'boolean' };
            case 'Int':
                return { type: 'integer' };
            case 'BigInt':
                return { type: 'bigint' };
            case 'Float':
                return { type: 'double precision' };
            case 'Decimal':
                return { type: 'decimal' };
            case 'DateTime':
                return { type: 'timestamp', precision: 3 };
            case 'Json':
                return { type: 'jsonb' };
            case 'Bytes':
                return { type: 'bytea' };
        }
    },
    getDefaultValue({ defaultValue, fieldType, datatype, datatype_name, services, enums }) {
        const val = defaultValue.trim();

        // Handle enum defaults (PostgreSQL returns 'value'::enum_type)
        if (datatype === 'enum' && datatype_name) {
            const enumDef = enums.find((e) => getDbName(e) === datatype_name);
            if (enumDef) {
                // Extract the enum value from the default (format: 'VALUE'::"enum_type")
                const enumValue = val.replace(/'/g, '').split('::')[0]?.trim();
                const enumField = enumDef.fields.find((f) => getDbName(f) === enumValue);
                if (enumField) {
                    return (ab) => ab.ReferenceExpr.setTarget(enumField);
                }
            }
            // Fall through to typeCastingConvert if datatype_name lookup fails
            return typeCastingConvert({defaultValue,enums,val,services});
        }

        switch (fieldType) {
            case 'DateTime':
                if (val === 'CURRENT_TIMESTAMP' || val === 'now()') {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('now', services));
                }

                if (val.includes('::')) {
                    return typeCastingConvert({defaultValue,enums,val,services});
                }

                // Fallback to string literal for other DateTime defaults
                return (ab) => ab.StringLiteral.setValue(val);

            case 'Int':
            case 'BigInt':
                if (val.startsWith('nextval(')) {
                    return (ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services));
                }

                if (val.includes('::')) {
                    return typeCastingConvert({defaultValue,enums,val,services});
                }
                return (ab) => ab.NumberLiteral.setValue(val);

            case 'Float':
                if (val.includes('::')) {
                    return typeCastingConvert({defaultValue,enums,val,services});
                }
                return normalizeFloatDefault(val);

            case 'Decimal':
                if (val.includes('::')) {
                    return typeCastingConvert({defaultValue,enums,val,services});
                }
                return normalizeDecimalDefault(val);

            case 'Boolean':
                return (ab) => ab.BooleanLiteral.setValue(val === 'true');

            case 'String':
                if (val.includes('::')) {
                    return typeCastingConvert({defaultValue,enums,val,services});
                }

                if (val.startsWith("'") && val.endsWith("'")) {
                    return (ab) => ab.StringLiteral.setValue(val.slice(1, -1).replace(/''/g, "'"));
                }
                return (ab) => ab.StringLiteral.setValue(val);
        }

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

        // Map PostgreSQL typname to Prisma native type attribute name
        // PostgreSQL returns typnames like 'int2', 'float8', 'bpchar', but Prisma attributes
        // are named @db.SmallInt, @db.DoublePrecision, @db.Char, etc.
        const nativeTypeName = pgTypnameToPrismaNativeType[datatype.toLowerCase()] ?? datatype;

        // Add @db.* attribute if the datatype differs from the default
        const dbAttr = services.shared.workspace.IndexManager.allElements('Attribute').find(
            (d) => d.name.toLowerCase() === `@db.${nativeTypeName.toLowerCase()}`,
        )?.node as Attribute | undefined;

        const defaultDatabaseType = this.getDefaultDatabaseType(fieldType as BuiltinType);

        // Normalize datatype for comparison (e.g., 'int4' -> 'integer')
        const normalizedDatatype = pgTypnameToStandard[datatype.toLowerCase()] ?? datatype.toLowerCase();

        // Check if the precision is the standard bit width for this type (shouldn't be added)
        const standardPrecision = standardTypePrecisions[datatype.toLowerCase()];
        const isStandardPrecision = standardPrecision !== undefined && precision === standardPrecision;

        if (
            dbAttr &&
            defaultDatabaseType &&
            (defaultDatabaseType.type !== normalizedDatatype ||
                (defaultDatabaseType.precision &&
                    defaultDatabaseType.precision !== (length || precision)))
        ) {
            const dbAttrFactory = new DataFieldAttributeFactory().setDecl(dbAttr);
            // Only add length/precision if it's meaningful (not the standard bit width for the type)
            if ((length || precision) && !isStandardPrecision) {
                dbAttrFactory.addArg((a) => a.NumberLiteral.setValue(length! || precision!));
            }
            factories.push(dbAttrFactory);
        }

        return factories;
    },
};

const enumIntrospectionQuery = `
SELECT
  n.nspname AS schema_name,
  t.typname AS enum_type,
  coalesce(json_agg(e.enumlabel ORDER BY e.enumsortorder), '[]') AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
GROUP BY schema_name, enum_type
ORDER BY schema_name, enum_type;`;

const tableIntrospectionQuery = `
SELECT
  "ns"."nspname" AS "schema",
  "cls"."relname" AS "name",
  CASE "cls"."relkind"
    WHEN 'r' THEN 'table'
    WHEN 'v' THEN 'view'
    ELSE NULL
  END AS "type",
  CASE
    WHEN "cls"."relkind" = 'v' THEN pg_get_viewdef("cls"."oid", true)
    ELSE NULL
  END AS "definition",
  (
    SELECT coalesce(json_agg(agg), '[]')
    FROM (
      SELECT
        "att"."attname" AS "name",
        CASE
          WHEN EXISTS (
            SELECT 1 FROM "pg_catalog"."pg_enum" AS "e"
            WHERE "e"."enumtypid" = "typ"."oid"
          ) THEN 'enum'
          ELSE "typ"."typname"
        END AS "datatype",
        CASE
          WHEN EXISTS (
            SELECT 1 FROM "pg_catalog"."pg_enum" AS "e"
            WHERE "e"."enumtypid" = "typ"."oid"
          ) THEN "typ"."typname"
          ELSE NULL
        END AS "datatype_name",
        "tns"."nspname" AS "datatype_schema",
        "c"."character_maximum_length" AS "length",
        COALESCE("c"."numeric_precision", "c"."datetime_precision") AS "precision",
        "fk_ns"."nspname" AS "foreign_key_schema",
        "fk_cls"."relname" AS "foreign_key_table",
        "fk_att"."attname" AS "foreign_key_column",
        "fk_con"."conname" AS "foreign_key_name",
        CASE "fk_con"."confupdtype"
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
          ELSE NULL
        END AS "foreign_key_on_update",
        CASE "fk_con"."confdeltype"
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
          ELSE NULL
        END AS "foreign_key_on_delete",
        "pk_con"."conkey" IS NOT NULL AS "pk",
        (
          EXISTS (
            SELECT 1
            FROM "pg_catalog"."pg_constraint" AS "u_con"
            WHERE "u_con"."contype" = 'u'
              AND "u_con"."conrelid" = "cls"."oid"
              AND array_length("u_con"."conkey", 1) = 1
              AND "att"."attnum" = ANY ("u_con"."conkey")
          )
          OR EXISTS (
            SELECT 1
            FROM "pg_catalog"."pg_index" AS "u_idx"
            WHERE "u_idx"."indrelid" = "cls"."oid"
              AND "u_idx"."indisunique" = TRUE
              AND "u_idx"."indnkeyatts" = 1
              AND "att"."attnum" = ANY ("u_idx"."indkey"::int2[])
          )
        ) AS "unique",
        (
          SELECT COALESCE(
            (
              SELECT "u_con"."conname"
              FROM "pg_catalog"."pg_constraint" AS "u_con"
              WHERE "u_con"."contype" = 'u'
                AND "u_con"."conrelid" = "cls"."oid"
                AND array_length("u_con"."conkey", 1) = 1
                AND "att"."attnum" = ANY ("u_con"."conkey")
              LIMIT 1
            ),
            (
              SELECT "u_idx_cls"."relname"
              FROM "pg_catalog"."pg_index" AS "u_idx"
              JOIN "pg_catalog"."pg_class" AS "u_idx_cls" ON "u_idx"."indexrelid" = "u_idx_cls"."oid"
              WHERE "u_idx"."indrelid" = "cls"."oid"
                AND "u_idx"."indisunique" = TRUE
                AND "u_idx"."indnkeyatts" = 1
                AND "att"."attnum" = ANY ("u_idx"."indkey"::int2[])
              LIMIT 1
            )
          )
        ) AS "unique_name",
        "att"."attgenerated" != '' AS "computed",
        pg_get_expr("def"."adbin", "def"."adrelid") AS "default",
        "att"."attnotnull" != TRUE AS "nullable",
        coalesce(
          (
            SELECT json_agg("enm"."enumlabel") AS "o"
            FROM "pg_catalog"."pg_enum" AS "enm"
            WHERE "enm"."enumtypid" = "typ"."oid"
          ),
          '[]'
        ) AS "options"

            FROM "pg_catalog"."pg_attribute" AS "att"

            INNER JOIN "pg_catalog"."pg_type" AS "typ" ON "typ"."oid" = "att"."atttypid"

            INNER JOIN "pg_catalog"."pg_namespace" AS "tns" ON "tns"."oid" = "typ"."typnamespace"

            LEFT JOIN "information_schema"."columns" AS "c" ON "c"."table_schema" = "ns"."nspname"
              AND "c"."table_name" = "cls"."relname"
              AND "c"."column_name" = "att"."attname"
            LEFT JOIN "pg_catalog"."pg_constraint" AS "pk_con" ON "pk_con"."contype" = 'p'

        AND "pk_con"."conrelid" = "cls"."oid"
        AND "att"."attnum" = ANY ("pk_con"."conkey")
      LEFT JOIN "pg_catalog"."pg_constraint" AS "fk_con" ON "fk_con"."contype" = 'f'
        AND "fk_con"."conrelid" = "cls"."oid"
        AND "att"."attnum" = ANY ("fk_con"."conkey")
      LEFT JOIN "pg_catalog"."pg_class" AS "fk_cls" ON "fk_cls"."oid" = "fk_con"."confrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "fk_ns" ON "fk_ns"."oid" = "fk_cls"."relnamespace"
      LEFT JOIN "pg_catalog"."pg_attribute" AS "fk_att" ON "fk_att"."attrelid" = "fk_cls"."oid"
        AND "fk_att"."attnum" = ANY ("fk_con"."confkey")
      LEFT JOIN "pg_catalog"."pg_attrdef" AS "def" ON "def"."adrelid" = "cls"."oid" AND "def"."adnum" = "att"."attnum"
      WHERE
        "att"."attrelid" = "cls"."oid"
        AND "att"."attnum" >= 0
        AND "att"."attisdropped" != TRUE
      ORDER BY "att"."attnum"
    ) AS agg
  ) AS "columns",
  (
    SELECT coalesce(json_agg(agg), '[]')
    FROM (
      SELECT
        "idx_cls"."relname" AS "name",
        "am"."amname" AS "method",
        "idx"."indisunique" AS "unique",
        "idx"."indisprimary" AS "primary",
        "idx"."indisvalid" AS "valid",
        "idx"."indisready" AS "ready",
        ("idx"."indpred" IS NOT NULL) AS "partial",
        pg_get_expr("idx"."indpred", "idx"."indrelid") AS "predicate",
        (
          SELECT json_agg(
            json_build_object(
              'name', COALESCE("att"."attname", pg_get_indexdef("idx"."indexrelid", "s"."i", true)),
              'expression', CASE WHEN "att"."attname" IS NULL THEN pg_get_indexdef("idx"."indexrelid", "s"."i", true) ELSE NULL END,
              'order', CASE ((( "idx"."indoption"::int2[] )["s"."i"] & 1)) WHEN 1 THEN 'DESC' ELSE 'ASC' END,
              'nulls', CASE (((( "idx"."indoption"::int2[] )["s"."i"] >> 1) & 1)) WHEN 1 THEN 'NULLS FIRST' ELSE 'NULLS LAST' END
            )
            ORDER BY "s"."i"
          )
          FROM generate_subscripts("idx"."indkey"::int2[], 1) AS "s"("i")
          LEFT JOIN "pg_catalog"."pg_attribute" AS "att"
            ON "att"."attrelid" = "cls"."oid"
           AND "att"."attnum" = ("idx"."indkey"::int2[])["s"."i"]
        ) AS "columns"
      FROM "pg_catalog"."pg_index" AS "idx"
      JOIN "pg_catalog"."pg_class" AS "idx_cls" ON "idx"."indexrelid" = "idx_cls"."oid"
      JOIN "pg_catalog"."pg_am" AS "am" ON "idx_cls"."relam" = "am"."oid"
      WHERE "idx"."indrelid" = "cls"."oid"
      ORDER BY "idx_cls"."relname"
    ) AS agg
  ) AS "indexes"
FROM "pg_catalog"."pg_class" AS "cls"
INNER JOIN "pg_catalog"."pg_namespace" AS "ns" ON "cls"."relnamespace" = "ns"."oid"
WHERE
  "ns"."nspname" !~ '^pg_'
  AND "ns"."nspname" != 'information_schema'
  AND "cls"."relkind" IN ('r', 'v')
  AND "cls"."relname" !~ '^pg_'
  AND "cls"."relname" !~ '_prisma_migrations'
  ORDER BY "ns"."nspname", "cls"."relname" ASC;
`;

function typeCastingConvert({defaultValue, enums, val, services}:{val: string, enums: Enum[], defaultValue:string, services:ZModelServices}): ((builder: ExpressionBuilder) => AstFactory<Expression>) | null {
    const [value, type] = val
        .replace(/'/g, '')
        .split('::')
        .map((s) => s.trim()) as [string, string];
    switch (type) {
        case 'character varying':
        case 'uuid':
        case 'json':
        case 'jsonb':
        case 'text':
            if (value === 'NULL') return null;
            return (ab) => ab.StringLiteral.setValue(value);
        case 'real':
            return (ab) => ab.NumberLiteral.setValue(value);
        default: {
            const enumDef = enums.find((e) => getDbName(e, true) === type);
            if (!enumDef) {
                return (ab) =>
                    ab.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                        a.setValue((v) => v.StringLiteral.setValue(val)),
                    );
            }
            const enumField = enumDef.fields.find((v) => getDbName(v) === value);
            if (!enumField) {
                throw new CliError(
                    `Enum value ${value} not found in enum ${type} for default value ${defaultValue}`,
                );
            }
            return (ab) => ab.ReferenceExpr.setTarget(enumField);
        }
    }
}
