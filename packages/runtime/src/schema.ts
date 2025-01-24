export type SupportedProviders = 'sqlite' | 'postgresql';

export type SchemaDef = {
    provider: SupportedProviders;
    models: Record<string, ModelDef>;
    enums?: Record<string, EnumDef>;
};

export type ModelDef = {
    fields: Record<string, FieldDef>;
    uniqueFields: Record<
        string,
        // singular unique field
        | Pick<FieldDef, 'type'>
        // compound unique field
        | Record<string, Pick<FieldDef, 'type'>>
    >;
};

export type RelationInfo = {
    fields?: string[];
    references?: string[];
    opposite?: string;
};

export type FieldDef = {
    type: string;
    array?: boolean;
    optional?: boolean;
    unique?: boolean;
    updatedAt?: boolean;
    default?: any;
    generator?:
        | 'autoincrement'
        | 'uuid4'
        | 'uuid7'
        | 'cuid'
        | 'cuid2'
        | 'nanoid'
        | 'ulid';
    relation?: RelationInfo;
    foreignKeyFor?: string[];
};

export type EnumDef = Record<string, string>;

//#region extraction

export type GetModels<Schema extends SchemaDef> = keyof Schema['models'];

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
    Model extends keyof Schema['models']
> = keyof Schema['models'][Model]['fields'];

export type GetField<
    Schema extends SchemaDef,
    Model extends keyof Schema['models'],
    Field extends GetFields<Schema, Model>
> = Schema['models'][Model]['fields'][Field];

export type GetFieldType<
    Schema extends SchemaDef,
    Model extends keyof Schema['models'],
    Field extends GetFields<Schema, Model>
> = Schema['models'][Model]['fields'][Field]['type'];

export type ScalarFields<
    Schema extends SchemaDef,
    Model extends keyof Schema['models']
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['relation'] extends object
        ? never
        : GetField<Schema, Model, Key>['foreignKeyFor'] extends string[]
        ? never
        : Key]: Key;
};

export type ForeignKeyFields<
    Schema extends SchemaDef,
    Model extends keyof Schema['models']
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['foreignKeyFor'] extends string[]
        ? Key
        : never]: Key;
};

export type RelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = Extract<
    keyof {
        [Key in GetFields<Schema, Model> as GetField<
            Schema,
            Model,
            Key
        >['relation'] extends object
            ? Key
            : never]: Key;
    },
    string
>;

export type FieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['type'];

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

export type FieldHasGenerator<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['generator'] extends string ? true : false;

export type FieldIsRelationArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = FieldIsRelation<Schema, Model, Field> extends true
    ? FieldIsArray<Schema, Model, Field>
    : false;

//#endregion
