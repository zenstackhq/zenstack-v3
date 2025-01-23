export type SchemaDef = {
    models: { [key: string]: ModelDef };
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
    relation?: RelationInfo;
    foreignKeyFor?: string[];
};

//#region extraction

export type GetModels<Schema extends SchemaDef> = keyof Schema['models'];

export type GetModel<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = Schema['models'][Model];

export type GetFields<
    Schema extends SchemaDef,
    Model extends keyof Schema['models']
> = keyof Schema['models'][Model]['fields'];

export type GetField<
    Schema extends SchemaDef,
    Model extends keyof Schema['models'],
    Field extends GetFields<Schema, Model>
> = Schema['models'][Model]['fields'][Field];

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
> = keyof {
    [Key in GetFields<Schema, Model> as GetField<
        Schema,
        Model,
        Key
    >['relation'] extends object
        ? Key
        : never]: Key;
};

//#endregion
