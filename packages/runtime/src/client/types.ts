import type { Optional } from 'utility-types';
import type {
    FieldDef,
    ForeignKeyFields,
    GetFields,
    RelationFields,
    RelationInfo,
    ScalarFields,
    SchemaDef,
    GetModels,
    GetField,
    GetModel,
} from '../schema';
import type {
    AtLeast,
    FieldMappedType,
    MapBaseType,
    OrArray,
    WrapType,
    XOR,
} from '../type-utils';

type DefaultModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Optional = false,
    Array = false
> = WrapType<
    {
        [Key in ScalarFields<Schema, Model>]: FieldMappedType<
            Schema['models'][Model]['fields'][Key]
        >;
    },
    Optional,
    Array
>;

type ModelSelectResult<
    S,
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    [Key in keyof S & GetFields<Schema, Model> as S[Key] extends
        | false
        | undefined
        ? never
        : Key]: Key extends ScalarFields<Schema, Model>
        ? FieldMappedType<GetField<Schema, Model, Key>>
        : S[Key] extends FindArgs<Schema, FieldType<Schema, Model, Key>>
        ? ModelResult<
              Schema,
              FieldType<Schema, Model, Key>,
              S[Key],
              FieldIsOptional<Schema, Model, Key>,
              FieldIsArray<Schema, Model, Key>
          >
        : DefaultModelResult<
              Schema,
              FieldType<Schema, Model, Key>,
              FieldIsOptional<Schema, Model, Key>,
              FieldIsArray<Schema, Model, Key>
          >;
};

export type ModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
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
                  FieldType<Schema, Model, Key>
              >
                  ? ModelResult<
                        Schema,
                        FieldType<Schema, Model, Key>,
                        I[Key],
                        FieldIsOptional<Schema, Model, Key>,
                        FieldIsArray<Schema, Model, Key>
                    >
                  : DefaultModelResult<
                        Schema,
                        FieldType<Schema, Model, Key>,
                        FieldIsOptional<Schema, Model, Key>,
                        FieldIsArray<Schema, Model, Key>
                    >;
          }
        : DefaultModelResult<Schema, Model>,
    Optional,
    Array
>;

export type Where<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in GetFields<Schema, Model>]?: Key extends RelationFields<
        Schema,
        Model
    >
        ? RelationFilter<Schema, Model, Key>
        : FieldMappedType<GetField<Schema, Model, Key>>;
};

export type WhereUnique<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = AtLeast<
    {
        [Key in keyof GetModel<Schema, Model>['uniqueFields']]?: GetModel<
            Schema,
            Model
        >['uniqueFields'][Key] extends Pick<FieldDef, 'type'>
            ? FieldMappedType<GetModel<Schema, Model>['uniqueFields'][Key]>
            : {
                  [Key1 in keyof GetModel<
                      Schema,
                      Model
                  >['uniqueFields'][Key]]: GetModel<
                      Schema,
                      Model
                  >['uniqueFields'][Key][Key1] extends Pick<FieldDef, 'type'>
                      ? FieldMappedType<
                            GetModel<Schema, Model>['uniqueFields'][Key][Key1]
                        >
                      : never;
              };
    } & Where<Schema, Model>,
    Extract<keyof GetModel<Schema, Model>['uniqueFields'], string>
>;

export type SelectInclude<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

export type FindArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    where?: Where<Schema, Model>;
} & SelectInclude<Schema, Model>;

export type FindUniqueArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    where?: WhereUnique<Schema, Model>;
} & SelectInclude<Schema, Model>;

export type CreateArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    data: CreateInput<Schema, Model>;
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

type FieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['type'];

type FieldIsOptional<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['optional'];

type FieldIsRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['relation'] extends object ? true : false;

type FieldIsArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['array'];

type FieldHasDefault<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['default'] extends
    | object
    | number
    | string
    | boolean
    ? true
    : false;

type FieldIsRelationArray<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = FieldIsRelation<Schema, Model, Field> extends true
    ? FieldIsArray<Schema, Model, Field>
    : false;

export type OptionalFieldsForCreate<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = keyof {
    [Key in GetFields<Schema, Model> as FieldIsOptional<
        Schema,
        Model,
        Key
    > extends true
        ? Key
        : FieldHasDefault<Schema, Model, Key> extends true
        ? Key
        : GetField<Schema, Model, Key>['updatedAt'] extends true
        ? Key
        : FieldIsRelationArray<Schema, Model, Key> extends true
        ? Key
        : never]: GetField<Schema, Model, Key>;
};

export type OptionalForCreate<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['optional'] extends true
    ? true
    : FieldHasDefault<Schema, Model, Field> extends true
    ? true
    : GetField<Schema, Model, Field>['updatedAt'] extends true
    ? true
    : false;

type GetRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = GetField<Schema, Model, Field>['relation'];

type OppositeRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>
> = FT extends GetModels<Schema>
    ? GetRelation<Schema, Model, Field> extends RelationInfo
        ? GetRelation<Schema, Model, Field>['opposite'] extends GetFields<
              Schema,
              FT
          >
            ? Schema['models'][FT]['fields'][GetRelation<
                  Schema,
                  Model,
                  Field
              >['opposite']]['relation']
            : never
        : never
    : never;

export type OppositeRelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    Opposite = OppositeRelation<Schema, Model, Field>
> = Opposite extends RelationInfo
    ? Opposite['fields'] extends string[]
        ? Opposite['fields']
        : []
    : [];

export type OppositeRelationAndFK<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>,
    Relation = GetField<Schema, Model, Field>['relation'],
    Opposite = Relation extends RelationInfo ? Relation['opposite'] : never
> = FT extends GetModels<Schema>
    ? Opposite extends GetFields<Schema, FT>
        ? Opposite | OppositeRelationFields<Schema, Model, Field>[number]
        : never
    : never;

//#region create input

type OptionalWrap<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    T extends object
> = Optional<T, keyof T & OptionalFieldsForCreate<Schema, Model>>;

type CreateScalarPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ScalarFields<Schema, Model>]: MapBaseType<
            FieldType<Schema, Model, Key>
        >;
    }
>;

type CreateFKPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ForeignKeyFields<Schema, Model>]: MapBaseType<
            FieldType<Schema, Model, Key>
        >;
    }
>;

type CreateRelationFieldPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = Omit<
    {
        create?: FieldIsArray<Schema, Model, Field> extends true
            ? OrArray<
                  CreateInput<
                      Schema,
                      FieldType<Schema, Model, Field>,
                      OppositeRelationAndFK<Schema, Model, Field>
                  >
              >
            : CreateInput<
                  Schema,
                  FieldType<Schema, Model, Field>,
                  OppositeRelationAndFK<Schema, Model, Field>
              >;

        createMany?: CreateManyPayload<
            Schema,
            FieldType<Schema, Model, Field>,
            OppositeRelationAndFK<Schema, Model, Field>
        >;

        connect?: FieldIsArray<Schema, Model, Field> extends true
            ? OrArray<WhereUnique<Schema, FieldType<Schema, Model, Field>>>
            : WhereUnique<Schema, FieldType<Schema, Model, Field>>;

        connectOrCreate?: FieldIsArray<Schema, Model, Field> extends true
            ? OrArray<
                  ConnectOrCreatePayload<
                      Schema,
                      FieldType<Schema, Model, Field>
                  >
              >
            : ConnectOrCreatePayload<Schema, FieldType<Schema, Model, Field>>;
    },
    // no "createMany" for non-array fields
    FieldIsArray<Schema, Model, Field> extends true ? never : 'createMany'
>;

type CreateRelationPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in RelationFields<Schema, Model>]: CreateRelationFieldPayload<
            Schema,
            Model,
            Key
        >;
    }
>;

type CreateWithFKInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = CreateScalarPayload<Schema, Model> & CreateFKPayload<Schema, Model>;

type CreateWithRelationInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = CreateScalarPayload<Schema, Model> & CreateRelationPayload<Schema, Model>;

type ConnectOrCreatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    where: WhereUnique<Schema, Model>;
    create: CreateInput<Schema, Model>;
};

type CreateManyPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never
> = {
    data: OrArray<
        Omit<CreateScalarPayload<Schema, Model>, Without> &
            Omit<CreateFKPayload<Schema, Model>, Without>
    >;
    skipDuplicates?: boolean;
};

export type CreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never
> = XOR<
    Omit<CreateWithFKInput<Schema, Model>, Without>,
    Omit<CreateWithRelationInput<Schema, Model>, Without>
>;

//#endregion

type Select<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in ScalarFields<Schema, Model>]?: boolean;
} & Include<Schema, Model>;

type Include<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in RelationFields<Schema, Model>]?:
        | boolean
        | FindArgs<Schema, FieldType<Schema, Model, Key>>;
};

export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
} & (T extends { select: any; include: any }
    ? 'Please either choose `select` or `include`.'
    : {});

type RelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? {
          every?: Where<Schema, FieldType<Schema, Model, Field>>;
          some?: Where<Schema, FieldType<Schema, Model, Field>>;
          none?: Where<Schema, FieldType<Schema, Model, Field>>;
      }
    : Where<Schema, FieldType<Schema, Model, Field>>;

type ModelOperations<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
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
    [Key in GetModels<Schema> as Key extends string
        ? Uncapitalize<Key>
        : never]: ModelOperations<Schema, Key>;
};
