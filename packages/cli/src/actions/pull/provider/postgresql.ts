import { AttributeArg, DataFieldAttribute, Expression, FunctionDecl, InvocationExpr } from '@zenstackhq/language/ast'
import { Client } from 'pg'
import { getAttributeRef, getDbName } from '../utils'
import type {
  IntrospectedEnum,
  IntrospectedSchema,
  IntrospectedTable,
  IntrospectionProvider,
} from './provider'

export const postgresql: IntrospectionProvider = {
  getBuiltinType(type) {
    const t = (type || '').toLowerCase()

    const isArray = t.startsWith('_')

    switch (t.replace(/^_/, '')) {
      // integers
      case 'int2':
      case 'smallint':
      case 'int4':
      case 'integer':
        return { type: 'Int', isArray }
      case 'int8':
      case 'bigint':
        return { type: 'BigInt', isArray }

      // decimals and floats
      case 'numeric':
      case 'decimal':
        return { type: 'Decimal', isArray }
      case 'float4':
      case 'real':
      case 'float8':
      case 'double precision':
        return { type: 'Float', isArray }

      // boolean
      case 'bool':
      case 'boolean':
        return { type: 'Boolean', isArray }

      // strings
      case 'text':
      case 'varchar':
      case 'bpchar':
      case 'character varying':
      case 'character':
        return { type: 'String', isArray }

      // uuid
      case 'uuid':
        return { type: 'String', isArray }

      // dates/times
      case 'date':
      case 'timestamp':
      case 'timestamptz':
        return { type: 'DateTime', isArray }

      // binary
      case 'bytea':
        return { type: 'Bytes', isArray }

      // json
      case 'json':
      case 'jsonb':
        return { type: 'Json', isArray }

      // unsupported or postgres-specific
      case 'time':
      case 'timetz':
      case 'interval':
      case 'money':
      case 'xml':
      case 'bit':
      case 'varbit':
      case 'cidr':
      case 'inet':
      case 'macaddr':
      case 'macaddr8':
      case 'point':
      case 'line':
      case 'lseg':
      case 'box':
      case 'path':
      case 'polygon':
      case 'circle':
      case 'tsvector':
      case 'tsquery':
      case 'jsonpath':
      case 'hstore':
      case 'oid':
      case 'name':
      case 'regclass':
      case 'regproc':
      case 'regprocedure':
      case 'regoper':
      case 'regoperator':
      case 'regtype':
      case 'regconfig':
      case 'regdictionary':
      case 'pg_lsn':
      case 'txid_snapshot':
      case 'int4range':
      case 'int8range':
      case 'numrange':
      case 'tsrange':
      case 'tstzrange':
      case 'daterange':
      default:
        return { type: 'Unsupported' as const, isArray }
    }
  },
  async introspect(connectionString: string): Promise<IntrospectedSchema> {
    const client = new Client({ connectionString })
    await client.connect()

    const { rows: tables } = await client.query<IntrospectedTable>(
      tableIntrospectionQuery
    )
    const { rows: enums } = await client.query<IntrospectedEnum>(
      enumIntrospectionQuery
    )

    return {
      enums,
      tables,
    }
  },
  getDefaultValue({ defaultValue, container: $container, fieldName, services, enums }) {
    // Handle common cases
    console.log(defaultValue);

    const val = defaultValue.trim()

    if (val === 'CURRENT_TIMESTAMP' || val === 'now()') {
      const attrs: DataFieldAttribute[] = [];

      attrs.push({
        $type: "DataFieldAttribute" as const,
        $container: $container as any,
        decl: {
          $refText: '@default',
          ref: getAttributeRef('@default', services)
        },
        get args(): AttributeArg[] {
          return [{
            $type: 'AttributeArg' as const,
            $container: this as any,
            get value(): Expression {
              return {
                $type: 'InvocationExpr' as const,
                $container: this,
                function: {
                  $refText: 'now',
                  ref: services.shared.workspace.IndexManager.allElements(FunctionDecl).find((f) => (f.node as FunctionDecl)?.name === 'now')?.node as FunctionDecl
                },
                args: [],
              } satisfies InvocationExpr
            }
          }]
        }
      });

      if (fieldName.toLowerCase() === 'updatedat' || fieldName.toLowerCase() === 'updated_at') {
        // for updatedAt, use @updatedAt attribute
        attrs.push({
          $type: "DataFieldAttribute" as const,
          $container: $container as any,
          decl: {
            $refText: 'updatedAt',
            ref: getAttributeRef('@updatedAt', services)
          },
          args: [],
        });
      }

      return attrs.length === 1 ? attrs[0] : attrs;
    }

    if (val.includes('::')) {
      const [enumValue, enumName] = val.replace(/'|"/g, '').split('::').map((s) => s.trim()) as [string, string]
      const enumDef = enums.find((e) => getDbName(e) === enumName)
      if (!enumDef) {
        throw new Error(`Enum type ${enumName} not found for default value ${defaultValue}`)
      }
      const enumField = enumDef.fields.find((v) => getDbName(v) === enumValue)
      if (!enumField) {
        throw new Error(`Enum value ${enumValue} not found in enum ${enumName} for default value ${defaultValue}`)
      }

      return {
        $type: 'ReferenceExpr' as const,
        $container: $container as any,
        target: {
          $refText: enumField!.name,
          ref: enumField,
        },
        args: [],
      }
    }

    if (val === 'true' || val === 'false') {
      return {
        $type: 'BooleanLiteral' as const,
        $container: $container as any,
        value: val === 'true',
      }
    }

    if (/^\d+$/.test(val)) {
      return {
        $container: $container as any,
        $type: 'NumberLiteral' as const,
        value: val,
      }
    }

    if (/^-?\d+(\.\d+)?$/.test(val)) {
      // float
      return {
        $container: $container as any,
        $type: 'NumberLiteral' as const,
        value: val,
      }
    }

    if (val.startsWith("'") && val.endsWith("'")) {
      // string
      return {
        $container: $container as any,
        $type: 'StringLiteral' as const,
        value: val.slice(1, -1).replace(/''/g, "'"),
      }
    }
    return undefined
  },
}

const enumIntrospectionQuery = `
SELECT
  n.nspname AS schema_name,
  t.typname AS enum_type,
  coalesce(json_agg(e.enumlabel ORDER BY e.enumsortorder), '[]') AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
GROUP BY schema_name, enum_type
ORDER BY schema_name, enum_type;`

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
  ) AS "columns"
FROM "pg_catalog"."pg_class" AS "cls"
INNER JOIN "pg_catalog"."pg_namespace" AS "ns" ON "cls"."relnamespace" = "ns"."oid"
WHERE
  "ns"."nspname" !~ '^pg_'
  AND "ns"."nspname" != 'information_schema'
  AND "cls"."relkind" IN ('r', 'v')
  AND "cls"."relname" !~ '^pg_'
  AND "cls"."relname" !~ '_prisma_migrations'
`
