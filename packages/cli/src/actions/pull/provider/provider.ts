import type { BuiltinType } from '@zenstackhq/language/ast'

export type Cascade = "NO ACTION" | "RESTRICT"| "CASCADE" | "SET NULL" | "SET DEFAULT" | null;

export interface IntrospectedTable {
  schema: string
  name: string
  type: 'table' | 'view'
  columns: {
    name: string
    datatype: string
    datatype_schema: string
    foreign_key_schema: string | null
    foreign_key_table: string | null
    foreign_key_column: string | null
    foreign_key_name: string | null
    foreign_key_on_update: Cascade
    foreign_key_on_delete: Cascade
    pk: boolean
    computed: boolean
    nullable: boolean
    options: string[]
    unique: boolean
  }[]
}

export type IntrospectedEnum = {
  schema_name: string
  enum_type: string
  values: string[]
}

export type IntrospectedSchema = {
  tables: IntrospectedTable[]
  enums: IntrospectedEnum[]
}

export interface IntrospectionProvider {
  introspect(connectionString: string): Promise<IntrospectedSchema>
  getBuiltinType(type: string): {
    type: BuiltinType | 'Unsupported'
    isArray: boolean
  }
}
