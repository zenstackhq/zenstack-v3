import type {
    FieldDef,
    RelationFields,
    RelationInfo,
    ScalarFields,
    SchemaDef,
} from '../schema';
import type {
    AtLeast,
    FieldType,
    MapBaseType,
    OrArray,
    WrapType,
} from '../utils';

type DefaultModelResult<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Optional = false,
    Array = false
> = WrapType<
    {
        [Key in ScalarFields<Schema, Model>]: FieldType<
            Schema[Model]['fields'][Key]
        >;
    },
    Optional,
    Array
>;

type ModelSelectResult<
    S,
    Schema extends SchemaDef,
    Model extends keyof Schema
> = {
    [Key in keyof S & keyof Schema[Model]['fields'] as S[Key] extends
        | false
        | undefined
        ? never
        : Key]: Key extends ScalarFields<Schema, Model>
        ? FieldType<Schema[Model]['fields'][Key]>
        : S[Key] extends FindArgs<Schema, Schema[Model]['fields'][Key]['type']>
        ? ModelResult<
              Schema,
              Schema[Model]['fields'][Key]['type'],
              S[Key],
              Schema[Model]['fields'][Key]['optional'],
              Schema[Model]['fields'][Key]['array']
          >
        : DefaultModelResult<
              Schema,
              Schema[Model]['fields'][Key]['type'],
              Schema[Model]['fields'][Key]['optional'],
              Schema[Model]['fields'][Key]['array']
          >;
};

export type ModelResult<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Args extends SelectInclude<Schema, Model> = {},
    Optional = false,
    Array = false
> = WrapType<
    Args extends {
        select: infer S;
    }
        ? ModelSelectResult<S, Schema, Model>
        : Args extends {
              include: infer I;
          }
        ? DefaultModelResult<Schema, Model> & {
              [Key in keyof I & RelationFields<Schema, Model> as I[Key] extends
                  | false
                  | undefined
                  ? never
                  : Key]: I[Key] extends FindArgs<
                  Schema,
                  Schema[Model]['fields'][Key]['type']
              >
                  ? ModelResult<
                        Schema,
                        Schema[Model]['fields'][Key]['type'],
                        I[Key],
                        Schema[Model]['fields'][Key]['optional'],
                        Schema[Model]['fields'][Key]['array']
                    >
                  : DefaultModelResult<
                        Schema,
                        Schema[Model]['fields'][Key]['type'],
                        Schema[Model]['fields'][Key]['optional'],
                        Schema[Model]['fields'][Key]['array']
                    >;
          }
        : DefaultModelResult<Schema, Model>,
    Optional,
    Array
>;

export type Where<Schema extends SchemaDef, Model extends keyof Schema> = {
    [Key in keyof Schema[Model]['fields']]?: Key extends RelationFields<
        Schema,
        Model
    >
        ? RelationFilter<Schema, Model, Key>
        : FieldType<Schema[Model]['fields'][Key]>;
};

export type WhereUnique<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = AtLeast<
    {
        [Key in keyof Schema[Model]['uniqueFields']]?: Schema[Model]['uniqueFields'][Key] extends Pick<
            FieldDef,
            'type'
        >
            ? FieldType<Schema[Model]['uniqueFields'][Key]>
            : {
                  [Key1 in keyof Schema[Model]['uniqueFields'][Key]]: Schema[Model]['uniqueFields'][Key][Key1] extends Pick<
                      FieldDef,
                      'type'
                  >
                      ? FieldType<Schema[Model]['uniqueFields'][Key][Key1]>
                      : never;
              };
    } & Where<Schema, Model>,
    Extract<keyof Schema[Model]['uniqueFields'], string>
>;

export type SelectInclude<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = {
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

export type FindArgs<Schema extends SchemaDef, Model extends keyof Schema> = {
    where?: Where<Schema, Model>;
} & SelectInclude<Schema, Model>;

export type FindUniqueArgs<
    Schema extends SchemaDef,
    Model extends keyof Schema
> = {
    where?: WhereUnique<Schema, Model>;
} & SelectInclude<Schema, Model>;

export type CreateArgs<Schema extends SchemaDef, Model extends keyof Schema> = {
    data: CreateInput<Schema, Model>;
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

type HasDefault<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields']
> = Schema[Model]['fields'][Field]['default'] extends
    | object
    | number
    | string
    | boolean
    ? true
    : false;

export type OptionalForCreate<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields']
> = Schema[Model]['fields'][Field]['optional'] extends true
    ? true
    : HasDefault<Schema, Model, Field> extends true
    ? true
    : Schema[Model]['fields'][Field]['updatedAt'] extends true
    ? true
    : false;

type GetRelation<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields']
> = Schema[Model]['fields'][Field]['relation'];

type OppositeRelation<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields'],
    FieldType = Schema[Model]['fields'][Field]['type']
> = FieldType extends keyof Schema
    ? GetRelation<Schema, Model, Field> extends RelationInfo
        ? GetRelation<
              Schema,
              Model,
              Field
          >['opposite'] extends keyof Schema[FieldType]['fields']
            ? Schema[FieldType]['fields'][GetRelation<
                  Schema,
                  Model,
                  Field
              >['opposite']]['relation']
            : never
        : never
    : never;

export type OppositeRelationFields<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields'],
    Opposite = OppositeRelation<Schema, Model, Field>
> = Opposite extends RelationInfo
    ? Opposite['fields'] extends string[]
        ? Opposite['fields']
        : []
    : [];

export type OppositeRelationAndFK<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields'],
    FieldType = Schema[Model]['fields'][Field]['type'],
    Relation = Schema[Model]['fields'][Field]['relation'],
    Opposite = Relation extends RelationInfo ? Relation['opposite'] : never
> = FieldType extends keyof Schema
    ? Opposite extends keyof Schema[FieldType]
        ? Opposite | OppositeRelationFields<Schema, Model, Field>[number]
        : never
    : never;

export type CreateInput<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Without extends string | undefined = undefined
> = {
    // non-optional fields
    [Key in Exclude<ScalarFields<Schema, Model>, Without> as OptionalForCreate<
        Schema,
        Model,
        Key
    > extends true
        ? never
        : Key]: MapBaseType<Schema[Model]['fields'][Key]['type']>;
} & {
    // optional fields
    [Key in Exclude<ScalarFields<Schema, Model>, Without> as OptionalForCreate<
        Schema,
        Model,
        Key
    > extends false
        ? never
        : Key]?: MapBaseType<Schema[Model]['fields'][Key]['type']>;
} & {
    // relation fields
    [Key in Exclude<RelationFields<Schema, Model>, Without>]?: {
        create: Schema[Model]['fields'][Key]['array'] extends true
            ? OrArray<
                  CreateInput<
                      Schema,
                      Schema[Model]['fields'][Key]['type'],
                      OppositeRelationAndFK<Schema, Model, Key>
                  >
              >
            : CreateInput<
                  Schema,
                  Schema[Model]['fields'][Key]['type'],
                  OppositeRelationAndFK<Schema, Model, Key>
              >;
    };
};

type Select<Schema extends SchemaDef, Model extends keyof Schema> = {
    [Key in ScalarFields<Schema, Model>]?: boolean;
} & Include<Schema, Model>;

type Include<Schema extends SchemaDef, Model extends keyof Schema> = {
    [Key in RelationFields<Schema, Model>]?:
        | boolean
        | FindArgs<Schema, Schema[Model]['fields'][Key]['type']>;
};

export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
} & (T extends { select: any; include: any }
    ? 'Please either choose `select` or `include`.'
    : {});

type RelationFilter<
    Schema extends SchemaDef,
    Model extends keyof Schema,
    Field extends keyof Schema[Model]['fields']
> = Schema[Model]['fields'][Field]['array'] extends true
    ? {
          every?: Where<Schema, Schema[Model]['fields'][Field]['type']>;
          some?: Where<Schema, Schema[Model]['fields'][Field]['type']>;
          none?: Where<Schema, Schema[Model]['fields'][Field]['type']>;
      }
    : Where<Schema, Schema[Model]['fields'][Field]['type']>;

type ModelOperations<Schema extends SchemaDef, Model extends keyof Schema> = {
    findMany<T extends FindArgs<Schema, Model>>(
        args?: SelectSubset<T, FindArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>[]>;

    findUnique<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    findFirst<T extends FindArgs<Schema, Model>>(
        args?: SelectSubset<T, FindArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    create<T extends CreateArgs<Schema, Model>>(
        args: SelectSubset<T, CreateArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;
};

export type DBClient<Schema extends SchemaDef> = {
    [Key in keyof Schema as Key extends string
        ? Uncapitalize<Key>
        : never]: ModelOperations<Schema, Key>;
};
