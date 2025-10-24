import { DataFieldAttributeFactory } from '@zenstackhq/language/factory';
import { Client } from 'pg';
import { getAttributeRef, getDbName, getFunctionRef } from '../utils';
import type { IntrospectedEnum, IntrospectedSchema, IntrospectedTable, IntrospectionProvider } from './provider';
import type { BuiltinType } from '@zenstackhq/language/ast';

export const postgresql: IntrospectionProvider = {
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
    async introspect(connectionString: string): Promise<IntrospectedSchema> {
        const client = new Client({ connectionString });
        await client.connect();

        const { rows: tables } = await client.query<IntrospectedTable>(tableIntrospectionQuery);
        const { rows: enums } = await client.query<IntrospectedEnum>(enumIntrospectionQuery);

        return {
            enums,
            tables,
        };
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
                return { type: 'timestamp', precisition: 3 };
            case 'Json':
                return { type: 'jsonb' };
            case 'Bytes':
                return { type: 'bytea' };
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
        if (val.startsWith('nextval(')) {
            factories.push(
                defaultAttr.addArg((ab) => ab.InvocationExpr.setFunction(getFunctionRef('autoincrement', services))),
            );
            return factories;
        }
        if (val.includes('(') && val.includes(')')) {
            factories.push(
                defaultAttr.addArg((a) =>
                    a.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                        a.setValue((v) => v.StringLiteral.setValue(val)),
                    ),
                ),
            );
            return factories;
        }

        if (val.includes('::')) {
            const [value, type] = val
                .replace(/'/g, '')
                .split('::')
                .map((s) => s.trim()) as [string, string];
            switch (type) {
                case 'character varying':
                case 'uuid':
                case 'json':
                case 'jsonb':
                    if (value === 'NULL') return [];
                    factories.push(defaultAttr.addArg((a) => a.StringLiteral.setValue(value)));
                    break;
                case 'real':
                    factories.push(defaultAttr.addArg((a) => a.NumberLiteral.setValue(value)));
                    break;
                default: {
                    const enumDef = enums.find((e) => getDbName(e, true) === type);
                    if (!enumDef) {
                        factories.push(
                            defaultAttr.addArg((a) =>
                                a.InvocationExpr.setFunction(getFunctionRef('dbgenerated', services)).addArg((a) =>
                                    a.setValue((v) => v.StringLiteral.setValue(val)),
                                ),
                            ),
                        );
                        break;
                    }
                    const enumField = enumDef.fields.find((v) => getDbName(v) === value);
                    if (!enumField) {
                        throw new Error(
                            `Enum value ${value} not found in enum ${type} for default value ${defaultValue}`,
                        );
                    }

                    factories.push(defaultAttr.addArg((ab) => ab.ReferenceExpr.setTarget(enumField)));
                    break;
                }
            }

            return factories;
        }

        if (val === 'true' || val === 'false') {
            factories.push(defaultAttr.addArg((ab) => ab.BooleanLiteral.setValue(val === 'true')));
            return factories;
        }

        if (/^\d+$/.test(val) || /^-?\d+(\.\d+)?$/.test(val)) {
            factories.push(defaultAttr.addArg((ab) => ab.NumberLiteral.setValue(val)));
            return factories;
        }

        if (val.startsWith("'") && val.endsWith("'")) {
            factories.push(defaultAttr.addArg((ab) => ab.StringLiteral.setValue(val.slice(1, -1).replace(/''/g, "'"))));
            return factories;
        }
        return [];
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
        "typ"."typname" AS "datatype",
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
