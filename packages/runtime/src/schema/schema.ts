import type Decimal from 'decimal.js';
import type { Expression } from './expression';

export type DataSourceProviderType = 'sqlite' | 'postgresql';

export type DataSourceProvider = {
    type: DataSourceProviderType;
    dialectConfigProvider: () => object;
};

export type SchemaDef = {
    provider: DataSourceProvider;
    models: Record<string, ModelDef>;
    enums?: Record<string, EnumDef>;
    plugins: Record<string, unknown>;
    procedures?: Record<string, ProcedureDef>;
};

export type ModelDef = {
    dbTable: string;
    fields: Record<string, FieldDef>;
    uniqueFields: Record<
        string,
        // singular unique field
        | Pick<FieldDef, 'type'>
        // compound unique field
        | Record<string, Pick<FieldDef, 'type'>>
    >;
    idFields: string[];
    policies?: Policy[];
    computedFields?: Record<string, Function>;
};

export type PolicyKind = 'allow' | 'deny';

export type PolicyOperation =
    | 'create'
    | 'read'
    | 'update'
    | 'post-update'
    | 'delete'
    | 'all';

export type Policy = {
    kind: PolicyKind;
    operations: PolicyOperation[];
    expression: Expression;
};

export type CascadeAction =
    | 'SetNull'
    | 'Cascade'
    | 'Restrict'
    | 'NoAction'
    | 'SetDefault';

export type RelationInfo = {
    fields?: string[];
    references?: string[];
    opposite?: string;
    onDelete?: CascadeAction;
    onUpdate?: CascadeAction;
};

export type FieldDefaultProvider = { call: string; args?: any[] };

export type FieldDef = {
    type: string;
    id?: boolean;
    array?: boolean;
    optional?: boolean;
    unique?: boolean;
    updatedAt?: boolean;
    default?: MappedBuiltinType | FieldDefaultProvider;
    relation?: RelationInfo;
    foreignKeyFor?: string[];
    computed?: boolean;
};

export type ProcedureParam = { name: string; type: string; optional?: boolean };

export type ProcedureDef = {
    params: [...ProcedureParam[]];
    returnType: string;
    mutation?: boolean;
};

export type BuiltinType =
    | 'String'
    | 'Boolean'
    | 'Int'
    | 'Float'
    | 'BigInt'
    | 'Decimal'
    | 'DateTime';

export type MappedBuiltinType =
    | string
    | boolean
    | number
    | bigint
    | Decimal
    | Date;

export type EnumDef = Record<string, string>;

//#region Extraction

export type GetModels<Schema extends SchemaDef> = Extract<
    keyof Schema['models'],
    string
>;

export type GetModel<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = Schema['models'][Model];

export type GetEnums<Schema extends SchemaDef> = keyof Schema['enums'];

export type GetEnum<
    Schema extends SchemaDef,
    Enum extends GetEnums<Schema>
> = Schema['enums'][Enum];

export type GetFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = keyof Schema['models'][Model]['fields'];

export type GetField<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = Schema['models'][Model]['fields'][Field];

export type GetFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = Schema['models'][Model]['fields'][Field]['type'];

export type ScalarFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    IncludeComputed extends boolean = true
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['relation'] extends object
        ? never
        : GetField<Schema, Model, Key>['foreignKeyFor'] extends string[]
        ? never
        : IncludeComputed extends true
        ? Key
        : FieldIsComputed<Schema, Model, Key> extends true
        ? never
        : Key]: Key;
};

export type ForeignKeyFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['foreignKeyFor'] extends string[]
        ? Key
        : never]: Key;
};

export type NonRelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['relation'] extends object
        ? never
        : Key]: Key;
};

export type RelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['relation'] extends object
        ? Key
        : never]: Key;
};

export type FieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['type'];

export type RelationFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = GetField<Schema, Model, Field>['type'] extends GetModels<Schema>
    ? GetField<Schema, Model, Field>['type']
    : never;

export type FieldIsOptional<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['optional'] extends true ? true : false;

export type FieldIsRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['relation'] extends object ? true : false;

export type FieldIsArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['array'] extends true ? true : false;

export type FieldIsComputed<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['computed'] extends true ? true : false;

export type FieldHasDefault<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['default'] extends
    | object
    | number
    | string
    | boolean
    ? true
    : GetField<Schema, Model, Field>['updatedAt'] extends true
    ? true
    : false;

export type FieldIsRelationArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = FieldIsRelation<Schema, Model, Field> extends true
    ? FieldIsArray<Schema, Model, Field>
    : false;

//#endregion
