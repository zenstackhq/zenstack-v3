import type Decimal from 'decimal.js';
import type { Expression } from './expression';

export type DataSourceProviderType = 'sqlite' | 'postgresql';

export type DataSourceProvider = {
    type: DataSourceProviderType;
    defaultSchema?: string;
};

export type SchemaDef = {
    provider: DataSourceProvider;
    models: Record<string, ModelDef>;
    enums?: Record<string, EnumDef>;
    typeDefs?: Record<string, TypeDefDef>;
    plugins: Record<string, unknown>;
    procedures?: Record<string, ProcedureDef>;
    authType?: GetModels<SchemaDef>;
};

export type ModelDef = {
    name: string;
    baseModel?: string;
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
    computedFields?: Record<string, Function>;
    isDelegate?: boolean;
    subModels?: string[];
    isView?: boolean;
};

export type AttributeApplication = {
    name: string;
    args?: AttributeArg[];
};

export type AttributeArg = {
    name?: string;
    value: Expression;
};

export type CascadeAction = 'SetNull' | 'Cascade' | 'Restrict' | 'NoAction' | 'SetDefault';

export type RelationInfo = {
    name?: string;
    fields?: string[];
    references?: string[];
    hasDefault?: boolean;
    opposite?: string;
    onDelete?: CascadeAction;
    onUpdate?: CascadeAction;
};

export type FieldDef = {
    name: string;
    type: string;
    id?: boolean;
    array?: boolean;
    optional?: boolean;
    unique?: boolean;
    updatedAt?: boolean;
    attributes?: AttributeApplication[];
    default?: MappedBuiltinType | Expression | unknown[];
    relation?: RelationInfo;
    foreignKeyFor?: string[];
    computed?: boolean;
    originModel?: string;
    isDiscriminator?: boolean;
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
    | 'Bytes'
    | 'Json'
    | 'Unsupported';

export type MappedBuiltinType = string | boolean | number | bigint | Decimal | Date;

export type EnumDef = Record<string, string>;

export type TypeDefDef = {
    name: string;
    fields: Record<string, FieldDef>;
    attributes?: AttributeApplication[];
};

//#region Extraction

export type GetModels<Schema extends SchemaDef> = Extract<keyof Schema['models'], string>;

export type GetDelegateModels<Schema extends SchemaDef> = keyof {
    [Key in GetModels<Schema> as Schema['models'][Key]['isDelegate'] extends true ? Key : never]: true;
};

export type GetSubModels<Schema extends SchemaDef, Model extends GetModels<Schema>> = GetModel<
    Schema,
    Model
>['subModels'] extends string[]
    ? Extract<GetModel<Schema, Model>['subModels'][number], GetModels<Schema>>
    : never;

export type GetModel<Schema extends SchemaDef, Model extends GetModels<Schema>> = Schema['models'][Model];

export type GetEnums<Schema extends SchemaDef> = keyof Schema['enums'];

export type GetEnum<Schema extends SchemaDef, Enum extends GetEnums<Schema>> = Schema['enums'][Enum];

export type GetTypeDefs<Schema extends SchemaDef> = Extract<keyof Schema['typeDefs'], string>;

export type GetTypeDef<Schema extends SchemaDef, TypeDef extends GetTypeDefs<Schema>> =
    Schema['typeDefs'] extends Record<string, unknown> ? Schema['typeDefs'][TypeDef] : never;

export type GetModelFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = Extract<
    keyof GetModel<Schema, Model>['fields'],
    string
>;

export type GetModelField<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModel<Schema, Model>['fields'][Field];

export type GetModelDiscriminator<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetModelFields<Schema, Model> as FieldIsDelegateDiscriminator<Schema, Model, Key> extends true
        ? GetModelField<Schema, Model, Key>['originModel'] extends string
            ? never
            : Key
        : never]: true;
};

export type GetModelFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = Schema['models'][Model]['fields'][Field]['type'];

export type GetTypeDefFields<Schema extends SchemaDef, TypeDef extends GetTypeDefs<Schema>> = Extract<
    keyof GetTypeDef<Schema, TypeDef>['fields'],
    string
>;

export type GetTypeDefField<
    Schema extends SchemaDef,
    TypeDef extends GetTypeDefs<Schema>,
    Field extends GetTypeDefFields<Schema, TypeDef>,
> = GetTypeDef<Schema, TypeDef>['fields'][Field];

export type ScalarFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    IncludeComputed extends boolean = true,
> = keyof {
    [Key in GetModelFields<Schema, Model> as GetModelField<Schema, Model, Key>['relation'] extends object
        ? never
        : GetModelField<Schema, Model, Key>['foreignKeyFor'] extends string[]
          ? never
          : IncludeComputed extends true
            ? Key
            : FieldIsComputed<Schema, Model, Key> extends true
              ? never
              : Key]: Key;
};

export type ForeignKeyFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetModelFields<Schema, Model> as GetModelField<Schema, Model, Key>['foreignKeyFor'] extends string[]
        ? Key
        : never]: Key;
};

export type NonRelationFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetModelFields<Schema, Model> as GetModelField<Schema, Model, Key>['relation'] extends object
        ? never
        : Key]: Key;
};

export type RelationFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetModelFields<Schema, Model> as GetModelField<Schema, Model, Key>['relation'] extends object
        ? Key
        : never]: Key;
};

export type FieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['type'];

export type RelationFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    GetModelField<Schema, Model, Field>['type'] extends GetModels<Schema>
        ? GetModelField<Schema, Model, Field>['type']
        : never;

export type ModelFieldIsOptional<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['optional'] extends true ? true : false;

export type TypeDefFieldIsOptional<
    Schema extends SchemaDef,
    TypeDef extends GetTypeDefs<Schema>,
    Field extends GetTypeDefFields<Schema, TypeDef>,
> = GetTypeDefField<Schema, TypeDef, Field>['optional'] extends true ? true : false;

export type FieldIsRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['relation'] extends object ? true : false;

export type FieldIsArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['array'] extends true ? true : false;

export type FieldIsComputed<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['computed'] extends true ? true : false;

export type FieldHasDefault<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['default'] extends object | number | string | boolean
    ? true
    : GetModelField<Schema, Model, Field>['updatedAt'] extends true
      ? true
      : GetModelField<Schema, Model, Field>['relation'] extends { hasDefault: true }
        ? true
        : false;

export type FieldIsRelationArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = FieldIsRelation<Schema, Model, Field> extends true ? FieldIsArray<Schema, Model, Field> : false;

export type IsDelegateModel<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
> = Schema['models'][Model]['isDelegate'] extends true ? true : false;

export type FieldIsDelegateRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    GetModelFieldType<Schema, Model, Field> extends GetModels<Schema>
        ? IsDelegateModel<Schema, GetModelFieldType<Schema, Model, Field>>
        : false;

export type FieldIsDelegateDiscriminator<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['isDiscriminator'] extends true ? true : false;

//#endregion
