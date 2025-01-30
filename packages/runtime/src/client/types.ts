import type { Optional } from 'utility-types';
import type {
    FieldDef,
    FieldHasDefault,
    FieldHasGenerator,
    FieldIsArray,
    FieldIsOptional,
    FieldIsRelationArray,
    FieldType,
    ForeignKeyFields,
    GetEnum,
    GetEnums,
    GetField,
    GetFields,
    GetModel,
    GetModels,
    RelationFields,
    RelationInfo,
    ScalarFields,
    SchemaDef,
} from '../schema';
import type {
    AtLeast,
    // FieldMappedType,
    MapBaseType,
    OrArray,
    WrapType,
    XOR,
} from '../type-utils';
import type { Kysely } from 'kysely';
import type { toKysely } from './query-builder';

//#region Query results

type DefaultModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Optional = false,
    Array = false
> = WrapType<
    {
        [Key in ScalarFields<Schema, Model>]: MapFieldType<Schema, Model, Key>;
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
        ? MapFieldType<Schema, Model, Key>
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

//#endregion

//#region Common structures

export type Where<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in GetFields<Schema, Model>]?: Key extends RelationFields<
        Schema,
        Model
    >
        ? RelationFilter<Schema, Model, Key>
        : MapFieldType<Schema, Model, Key>;
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
            ? MapFieldDefType<
                  Schema,
                  GetModel<Schema, Model>['uniqueFields'][Key]
              >
            : {
                  [Key1 in keyof GetModel<
                      Schema,
                      Model
                  >['uniqueFields'][Key]]: GetModel<
                      Schema,
                      Model
                  >['uniqueFields'][Key][Key1] extends Pick<FieldDef, 'type'>
                      ? MapFieldDefType<
                            Schema,
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

//#endregion

//#region Field utils

export type MapFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = MapFieldDefType<Schema, GetField<Schema, Model, Field>>;

// WrapType<
//     GetFieldType<Schema, Model, Field> extends GetEnums<Schema>
//         ? 'foo'
//         : MapBaseType<GetField<Schema, Model, Field>>,
//     FieldIsOptional<Schema, Model, Field>,
//     FieldIsArray<Schema, Model, Field>
// >;

type MapFieldDefType<
    Schema extends SchemaDef,
    T extends Pick<FieldDef, 'type' | 'optional' | 'array'>
> = WrapType<
    T['type'] extends GetEnums<Schema>
        ? keyof GetEnum<Schema, T['type']>
        : MapBaseType<T['type']>,
    T['optional'],
    T['array']
>;

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
        : FieldHasGenerator<Schema, Model, Key> extends true
        ? Key
        : GetField<Schema, Model, Key>['updatedAt'] extends true
        ? Key
        : FieldIsRelationArray<Schema, Model, Key> extends true
        ? Key
        : never]: GetField<Schema, Model, Key>;
};

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

//#endregion

//#region Find args

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

//#endregion

//#region Create args

export type CreateArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    data: CreateInput<Schema, Model>;
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

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
        [Key in ScalarFields<Schema, Model>]: MapFieldType<Schema, Model, Key>;
    }
>;

type CreateFKPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ForeignKeyFields<Schema, Model>]: MapFieldType<
            Schema,
            Model,
            Key
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

//#region Client API

export type ModelOperations<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    findMany<T extends FindArgs<Schema, Model>>(
        args?: SelectSubset<T, FindArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>[]>;

    findUnique<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    findUniqueOrThrow<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;

    findFirst<T extends FindArgs<Schema, Model>>(
        args?: SelectSubset<T, FindArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    findFirstOrThrow<T extends FindArgs<Schema, Model>>(
        args?: SelectSubset<T, FindArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;

    create<T extends CreateArgs<Schema, Model>>(
        args: SelectSubset<T, CreateArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;
};

export type DBClient<Schema extends SchemaDef> = {
    $db: Kysely<toKysely<Schema>>;
} & {
    [Key in GetModels<Schema> as Key extends string
        ? Uncapitalize<Key>
        : never]: ModelOperations<Schema, Key>;
};

//#endregion
