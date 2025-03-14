import type { ExpressionBuilder, OperandExpression, SqlBool } from 'kysely';
import type { Optional } from 'utility-types';
import type {
    BuiltinType,
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
    GetFieldType,
    GetModel,
    GetModels,
    NonRelationFields,
    RelationFields,
    RelationFieldType,
    RelationInfo,
    ScalarFields,
    SchemaDef,
} from '../schema/schema';
import type {
    AtLeast,
    MapBaseType,
    NullableIf,
    OrArray,
    WrapType,
    XOR,
} from '../utils/type-utils';
import type { ToKyselySchema } from './query-builder';

//#region Query results

type DefaultModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Optional = false,
    Array = false
> = WrapType<
    {
        [Key in NonRelationFields<Schema, Model>]: MapFieldType<
            Schema,
            Model,
            Key
        >;
    },
    Optional,
    Array
>;

type ModelSelectResult<
    Select,
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    [Key in keyof Select & GetFields<Schema, Model> as Select[Key] extends
        | false
        | undefined
        ? never
        : Key]: Key extends ScalarFields<Schema, Model>
        ? MapFieldType<Schema, Model, Key>
        : Key extends RelationFields<Schema, Model>
        ? Select[Key] extends FindArgs<
              Schema,
              RelationFieldType<Schema, Model, Key>,
              FieldIsArray<Schema, Model, Key>
          >
            ? ModelResult<
                  Schema,
                  RelationFieldType<Schema, Model, Key>,
                  Select[Key],
                  FieldIsOptional<Schema, Model, Key>,
                  FieldIsArray<Schema, Model, Key>
              >
            : DefaultModelResult<
                  Schema,
                  RelationFieldType<Schema, Model, Key>,
                  FieldIsOptional<Schema, Model, Key>,
                  FieldIsArray<Schema, Model, Key>
              >
        : never;
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
                  RelationFieldType<Schema, Model, Key>,
                  FieldIsArray<Schema, Model, Key>
              >
                  ? ModelResult<
                        Schema,
                        RelationFieldType<Schema, Model, Key>,
                        I[Key],
                        FieldIsOptional<Schema, Model, Key>,
                        FieldIsArray<Schema, Model, Key>
                    >
                  : DefaultModelResult<
                        Schema,
                        RelationFieldType<Schema, Model, Key>,
                        FieldIsOptional<Schema, Model, Key>,
                        FieldIsArray<Schema, Model, Key>
                    >;
          }
        : DefaultModelResult<Schema, Model>,
    Optional,
    Array
>;

export type BatchResult = { count: number };

//#endregion

//#region Common structures

export type Where<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    ScalarOnly extends boolean = false
> = {
    [Key in GetFields<Schema, Model> as ScalarOnly extends true
        ? Key extends RelationFields<Schema, Model>
            ? never
            : Key
        : Key]?: Key extends RelationFields<Schema, Model>
        ? // relation
          RelationFilter<Schema, Model, Key>
        : // enum
        GetFieldType<Schema, Model, Key> extends GetEnums<Schema>
        ? EnumFilter<
              Schema,
              GetFieldType<Schema, Model, Key>,
              FieldIsOptional<Schema, Model, Key>
          >
        : // primitive
          PrimitiveFilter<
              GetFieldType<Schema, Model, Key>,
              FieldIsOptional<Schema, Model, Key>
          >;
} & {
    $expr?: (
        eb: ExpressionBuilder<
            ToKyselySchema<Schema>,
            GetModel<Schema, Model>['dbTable']
        >
    ) => OperandExpression<SqlBool>;
} & {
    AND?: OrArray<Where<Schema, Model, ScalarOnly>>;
    OR?: Where<Schema, Model, ScalarOnly>[];
    NOT?: OrArray<Where<Schema, Model, ScalarOnly>>;
};

export type EnumFilter<
    Schema extends SchemaDef,
    T extends GetEnums<Schema>,
    Nullable extends boolean
> =
    | NullableIf<keyof GetEnum<Schema, T>, Nullable>
    | {
          equals?: NullableIf<keyof GetEnum<Schema, T>, Nullable>;
          in?: (keyof GetEnum<Schema, T>)[];
          notIn?: (keyof GetEnum<Schema, T>)[];
          not?: EnumFilter<Schema, T, Nullable>;
      };

export type PrimitiveFilter<
    T extends string,
    Nullable extends boolean
> = T extends 'String'
    ? StringFilter<Nullable>
    : T extends 'Int' | 'Float' | 'Decimal' | 'BigInt'
    ? NumberFilter<T, Nullable>
    : T extends 'Boolean'
    ? BooleanFilter<Nullable>
    : T extends 'DateTime'
    ? DateTimeFilter<Nullable>
    : T extends 'Json'
    ? 'Not implemented yet' // TODO: Json filter
    : never;

export type CommonPrimitiveFilter<
    DataType,
    T extends BuiltinType,
    Nullable extends boolean
> = {
    equals?: NullableIf<DataType, Nullable>;
    in?: DataType[];
    notIn?: DataType[];
    lt?: DataType;
    lte?: DataType;
    gt?: DataType;
    gte?: DataType;
    not?: PrimitiveFilter<T, Nullable>;
};

export type StringFilter<Nullable extends boolean> =
    | NullableIf<string, Nullable>
    | (CommonPrimitiveFilter<string, 'String', Nullable> & {
          contains?: string;
          startsWith?: string;
          endsWith?: string;
          mode?: 'default' | 'insensitive';
      });

export type NumberFilter<
    T extends 'Int' | 'Float' | 'Decimal' | 'BigInt',
    Nullable extends boolean
> =
    | NullableIf<number | bigint, Nullable>
    | CommonPrimitiveFilter<number, T, Nullable>;

export type DateTimeFilter<Nullable extends boolean> =
    | NullableIf<Date | string, Nullable>
    | CommonPrimitiveFilter<Date | string, 'DateTime', Nullable>;

export type BooleanFilter<Nullable extends boolean> =
    | NullableIf<boolean, Nullable>
    | {
          equals?: NullableIf<boolean, Nullable>;
          not?: BooleanFilter<Nullable>;
      };

export type SortOrder = 'asc' | 'desc';
export type NullsOrder = 'first' | 'last';

export type OrderBy<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    [Key in NonRelationFields<Schema, Model>]?: FieldIsOptional<
        Schema,
        Model,
        Key
    > extends true
        ? {
              sort: SortOrder;
              nulls?: NullsOrder;
          }
        : SortOrder;
} & {
    [Key in RelationFields<Schema, Model>]?: FieldIsArray<
        Schema,
        Model,
        Key
    > extends true
        ? {
              _count?: SortOrder;
          }
        : OrderBy<Schema, RelationFieldType<Schema, Model, Key>>;
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
        | FindArgs<
              Schema,
              RelationFieldType<Schema, Model, Key>,
              FieldIsArray<Schema, Model, Key>,
              // where clause is allowed only if the relation is array or optional
              FieldIsArray<Schema, Model, Key> extends true
                  ? true
                  : FieldIsOptional<Schema, Model, Key> extends true
                  ? true
                  : false
          >;
};

export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
} & (T extends { select: any; include: any }
    ? 'Please either choose `select` or `include`.'
    : {});

type ToManyRelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = {
    every?: Where<Schema, RelationFieldType<Schema, Model, Field>>;
    some?: Where<Schema, RelationFieldType<Schema, Model, Field>>;
    none?: Where<Schema, RelationFieldType<Schema, Model, Field>>;
};

type ToOneRelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = NullableIf<
    Where<Schema, RelationFieldType<Schema, Model, Field>> & {
        is?: NullableIf<
            Where<Schema, RelationFieldType<Schema, Model, Field>>,
            FieldIsOptional<Schema, Model, Field>
        >;
        isNot?: NullableIf<
            Where<Schema, RelationFieldType<Schema, Model, Field>>,
            FieldIsOptional<Schema, Model, Field>
        >;
    },
    FieldIsOptional<Schema, Model, Field>
>;

type RelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? ToManyRelationFilter<Schema, Model, Field>
    : ToOneRelationFilter<Schema, Model, Field>;

//#endregion

//#region Field utils

export type MapFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = MapFieldDefType<Schema, GetField<Schema, Model, Field>>;

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
    Model extends GetModels<Schema>,
    Collection extends boolean,
    AllowFilter extends boolean = true
> = (Collection extends true
    ? {
          skip?: number;
          take?: number;
          orderBy?: OrArray<OrderBy<Schema, Model>>;
      }
    : {}) &
    (AllowFilter extends true
        ? {
              where?: Where<Schema, Model>;
          }
        : {}) &
    SelectInclude<Schema, Model>;

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

export type CreateManyArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = CreateManyPayload<Schema, Model>;

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
        create?: NestedCreateInput<Schema, Model, Field>;
        createMany?: NestedCreateManyInput<Schema, Model, Field>;
        connect?: ConnectInput<Schema, Model, Field>;
        connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
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

// #region Update args

export type UpdateArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    data: UpdateInput<Schema, Model>;
    where: WhereUnique<Schema, Model>;
    select?: Select<Schema, Model>;
    include?: Include<Schema, Model>;
};

export type UpdateManyArgs<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    data: OrArray<UpdateScalarInput<Schema, Model>>;
    where?: Where<Schema, Model>;
    limit?: number;
};

export type UpdateScalarInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never
> = Omit<
    {
        [Key in NonRelationFields<Schema, Model>]?: MapFieldType<
            Schema,
            Model,
            Key
        >;
    },
    Without
>;

export type UpdateRelationInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never
> = Omit<
    {
        [Key in RelationFields<Schema, Model>]?: UpdateRelationFieldPayload<
            Schema,
            Model,
            Key
        >;
    },
    Without
>;

export type UpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never
> = UpdateScalarInput<Schema, Model, Without> &
    UpdateRelationInput<Schema, Model, Without>;

type UpdateRelationFieldPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = Omit<
    {
        create?: NestedCreateInput<Schema, Model, Field>;
        createMany?: NestedCreateManyInput<Schema, Model, Field>;
        connect?: ConnectInput<Schema, Model, Field>;
        connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
        disconnect?: DisconnectInput<Schema, Model, Field>;
        set?: SetInput<Schema, Model, Field>;
        update?: NestedUpdateInput<Schema, Model, Field>;
        upsert?: NestedUpsertInput<Schema, Model, Field>;
        updateMany?: NestedUpdateManyInput<Schema, Model, Field>;
        delete?: NestedDeleteInput<Schema, Model, Field>;
        deleteMany?: NestedDeleteManyInput<Schema, Model, Field>;
    },
    // no "createMany" for non-array fields
    FieldIsArray<Schema, Model, Field> extends true
        ? never
        : 'createMany' | 'set'
>;

// #endregion

// #region Relation manipulation

type NestedCreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = OrArray<
    CreateInput<
        Schema,
        RelationFieldType<Schema, Model, Field>,
        OppositeRelationAndFK<Schema, Model, Field>
    >,
    FieldIsArray<Schema, Model, Field>
>;

type NestedCreateManyInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = CreateManyPayload<
    Schema,
    RelationFieldType<Schema, Model, Field>,
    OppositeRelationAndFK<Schema, Model, Field>
>;

type ConnectInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? OrArray<WhereUnique<Schema, RelationFieldType<Schema, Model, Field>>>
    : WhereUnique<Schema, RelationFieldType<Schema, Model, Field>>;

type ConnectOrCreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? OrArray<
          ConnectOrCreatePayload<
              Schema,
              RelationFieldType<Schema, Model, Field>
          >
      >
    : ConnectOrCreatePayload<Schema, RelationFieldType<Schema, Model, Field>>;

type DisconnectInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? OrArray<
          WhereUnique<Schema, RelationFieldType<Schema, Model, Field>>,
          true
      >
    : boolean | Where<Schema, RelationFieldType<Schema, Model, Field>>;

type SetInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = OrArray<WhereUnique<Schema, RelationFieldType<Schema, Model, Field>>>;

type NestedUpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? OrArray<
          {
              where: WhereUnique<
                  Schema,
                  RelationFieldType<Schema, Model, Field>
              >;
              data: UpdateInput<
                  Schema,
                  RelationFieldType<Schema, Model, Field>,
                  OppositeRelationAndFK<Schema, Model, Field>
              >;
          },
          true
      >
    : XOR<
          {
              where: WhereUnique<
                  Schema,
                  RelationFieldType<Schema, Model, Field>
              >;
              data: UpdateInput<
                  Schema,
                  RelationFieldType<Schema, Model, Field>,
                  OppositeRelationAndFK<Schema, Model, Field>
              >;
          },
          UpdateInput<
              Schema,
              RelationFieldType<Schema, Model, Field>,
              OppositeRelationAndFK<Schema, Model, Field>
          >
      >;

type NestedUpsertInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = OrArray<
    {
        where: WhereUnique<Schema, Model>;
        create: CreateInput<
            Schema,
            RelationFieldType<Schema, Model, Field>,
            OppositeRelationAndFK<Schema, Model, Field>
        >;
        update: UpdateInput<
            Schema,
            RelationFieldType<Schema, Model, Field>,
            OppositeRelationAndFK<Schema, Model, Field>
        >;
    },
    FieldIsArray<Schema, Model, Field>
>;

type NestedUpdateManyInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = OrArray<
    {
        where: Where<Schema, RelationFieldType<Schema, Model, Field>>;
        data: UpdateInput<
            Schema,
            RelationFieldType<Schema, Model, Field>,
            OppositeRelationAndFK<Schema, Model, Field>
        >;
    },
    true
>;

type NestedDeleteInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = FieldIsArray<Schema, Model, Field> extends true
    ? OrArray<
          WhereUnique<Schema, RelationFieldType<Schema, Model, Field>>,
          true
      >
    : boolean | Where<Schema, RelationFieldType<Schema, Model, Field>>;

type NestedDeleteManyInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>
> = OrArray<Where<Schema, RelationFieldType<Schema, Model, Field>, true>>;

// #endregion

//#region Client API

export type ModelOperations<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    findMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>
    ): Promise<ModelResult<Schema, Model, T>[]>;

    findUnique<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    findUniqueOrThrow<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;

    findFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>
    ): Promise<ModelResult<Schema, Model, T> | null>;

    findFirstOrThrow<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>
    ): Promise<ModelResult<Schema, Model, T>>;

    create<T extends CreateArgs<Schema, Model>>(
        args: SelectSubset<T, CreateArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;

    createMany(args?: CreateManyPayload<Schema, Model>): Promise<BatchResult>;

    update<T extends UpdateArgs<Schema, Model>>(
        args: SelectSubset<T, UpdateArgs<Schema, Model>>
    ): Promise<ModelResult<Schema, Model, T>>;

    updateMany(args: UpdateManyArgs<Schema, Model>): Promise<BatchResult>;
};

//#endregion
