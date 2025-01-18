export type SchemaDef = {
    [key: string]: ModelDef;
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
};

export type Fields<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = keyof Schema[Model]['fields'];

export type ScalarFields<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = keyof {
    [Key in Fields<
        Schema,
        Model
    > as Schema[Model]['fields'][Key]['relation'] extends object
        ? never
        : Key]: Key;
};

export type RelationFields<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = keyof {
    [Key in Fields<
        Schema,
        Model
    > as Schema[Model]['fields'][Key]['relation'] extends object
        ? Key
        : never]: Key;
};
