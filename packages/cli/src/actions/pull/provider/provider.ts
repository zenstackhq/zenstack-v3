import type { ZModelServices } from '@zenstackhq/language';
import type { BuiltinType, Enum } from '@zenstackhq/language/ast';
import type { DataFieldAttributeFactory } from '@zenstackhq/language/factory';

export type Cascade = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | null;

export interface IntrospectedTable {
    schema: string;
    name: string;
    type: 'table' | 'view';
    definition: string | null;
    columns: {
        name: string;
        datatype: string;
        datatype_schema: string;
        foreign_key_schema: string | null;
        foreign_key_table: string | null;
        foreign_key_column: string | null;
        foreign_key_name: string | null;
        foreign_key_on_update: Cascade;
        foreign_key_on_delete: Cascade;
        pk: boolean;
        computed: boolean;
        nullable: boolean;
        options: string[];
        unique: boolean;
        unique_name: string | null;
        default: string | null;
    }[];
    indexes: {
        name: string;
        method: string | null;
        unique: boolean;
        primary: boolean;
        valid: boolean;
        ready: boolean;
        partial: boolean;
        predicate: string | null;
        columns: {
            name: string;
            expression: string | null;
            order: 'ASC' | 'DESC' | null;
            nulls: string | null;
        }[];
    }[];
}

export type IntrospectedEnum = {
    schema_name: string;
    enum_type: string;
    values: string[];
};

export type IntrospectedSchema = {
    tables: IntrospectedTable[];
    enums: IntrospectedEnum[];
};

export interface IntrospectionProvider {
    introspect(connectionString: string): Promise<IntrospectedSchema>;
    getBuiltinType(type: string): {
        type: BuiltinType | 'Unsupported';
        isArray: boolean;
    };
    getDefaultValue(args: {
        fieldName: string;
        defaultValue: string;
        services: ZModelServices;
        enums: Enum[];
    }): DataFieldAttributeFactory[];
}
