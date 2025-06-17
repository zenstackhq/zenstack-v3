import type Decimal from 'decimal.js';
import type { Expression } from './expression';

export type DataSourceProviderType = 'sqlite' | 'postgresql';

export type DataSourceProvider = {
    type: DataSourceProviderType;
};

export type SchemaDef = {
    provider: DataSourceProvider;
    models: Record<string, ModelDef>;
    enums?: Record<string, EnumDef>;
    plugins: Record<string, unknown>;
    procedures?: Record<string, ProcedureDef>;
    authType?: GetModels<SchemaDef>;
};

export type ModelDef = {
    fields: Record<string, FieldDef>;
    attributes?: AttributeApplication[];
    uniqueFields: Record<
        string,
        // singular unique field
        | Pick<FieldDef, 'type'>
        // compound unique field
        | Record<string, Pick<FieldDef, 'type'>>
    >;
    idFields: string[];
    // eslint-disable-next-line @typescript-eslint/ban-types
    computedFields?: Record<string, Function>;
};

export type AttributeApplication = {
    name: string;
    args?: AttributeArg[];
};

export type AttributeArg = {
    name?: string;
    value: Expression;
};

export type CascadeAction =
    | 'SetNull'
    | 'Cascade'
    | 'Restrict'
    | 'NoAction'
    | 'SetDefault';

export type RelationInfo = {
    name?: string;
    fields?: string[];
    references?: string[];
    opposite?: string;
    onDelete?: CascadeAction;
    onUpdate?: CascadeAction;
};

export type FieldDef = {
    type: string;
    id?: boolean;
    array?: boolean;
    optional?: boolean;
    unique?: boolean;
    updatedAt?: boolean;
    attributes?: AttributeApplication[];
    default?: MappedBuiltinType | Expression;
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
    | 'DateTime'
    | 'Bytes';

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
> = Extract<keyof GetModel<Schema, Model>['fields'], string>;

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
