import type { ExpressionBuilder, OperandExpression, SqlBool } from 'kysely';
import type {
    BuiltinType,
    FieldDef,
    FieldHasDefault,
    FieldIsArray,
    FieldIsOptional,
    FieldIsRelation,
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
} from '../schema';
import type {
    AtLeast,
    MapBaseType,
    NonEmptyArray,
    NullableIf,
    Optional,
    OrArray,
    ValueOfPotentialTuple,
    WrapType,
    XOR,
} from '../utils/type-utils';
import type { ToKyselySchema } from './query-builder';

//#region Query results

type DefaultModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Omit = undefined,
    Optional = false,
    Array = false,
> = WrapType<
    {
        [Key in NonRelationFields<Schema, Model> as Key extends keyof Omit
            ? Omit[Key] extends true
                ? never
                : Key
            : Key]: MapFieldType<Schema, Model, Key>;
    },
    Optional,
    Array
>;

type ModelSelectResult<Schema extends SchemaDef, Model extends GetModels<Schema>, Select, Omit> = {
    [Key in keyof Select as Select[Key] extends false | undefined
        ? never
        : Key extends keyof Omit
          ? Omit[Key] extends true
              ? never
              : Key
          : Key extends '_count'
            ? Select[Key] extends SelectCount<Schema, Model>
                ? Key
                : never
            : Key]: Key extends '_count'
        ? SelectCountResult<Schema, Model, Select[Key]>
        : Key extends NonRelationFields<Schema, Model>
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
                      Omit,
                      FieldIsOptional<Schema, Model, Key>,
                      FieldIsArray<Schema, Model, Key>
                  >
            : never;
};

type SelectCountResult<Schema extends SchemaDef, Model extends GetModels<Schema>, C> = C extends true
    ? {
          // count all to-many relation fields
          [Key in RelationFields<Schema, Model> as FieldIsArray<Schema, Model, Key> extends true ? Key : never]: number;
      }
    : C extends { select: infer S }
      ? { [Key in keyof S]: number }
      : never;

export type ModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Args extends SelectIncludeOmit<Schema, Model, boolean> = {},
    Optional = false,
    Array = false,
> = WrapType<
    Args extends {
        select: infer S;
        omit?: infer O;
    }
        ? ModelSelectResult<Schema, Model, S, O>
        : Args extends {
                include: infer I;
                omit?: infer O;
            }
          ? DefaultModelResult<Schema, Model, O> & {
                [Key in keyof I & RelationFields<Schema, Model> as I[Key] extends false | undefined
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
                          undefined,
                          FieldIsOptional<Schema, Model, Key>,
                          FieldIsArray<Schema, Model, Key>
                      >;
            }
          : Args extends { omit: infer O }
            ? DefaultModelResult<Schema, Model, O>
            : DefaultModelResult<Schema, Model>,
    Optional,
    Array
>;

export type BatchResult = { count: number };

//#endregion

//#region Common structures

export type WhereInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    ScalarOnly extends boolean = false,
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
          ? EnumFilter<Schema, GetFieldType<Schema, Model, Key>, FieldIsOptional<Schema, Model, Key>>
          : FieldIsArray<Schema, Model, Key> extends true
            ? ArrayFilter<GetFieldType<Schema, Model, Key>>
            : // primitive
              PrimitiveFilter<GetFieldType<Schema, Model, Key>, FieldIsOptional<Schema, Model, Key>>;
} & {
    $expr?: (eb: ExpressionBuilder<ToKyselySchema<Schema>, Model>) => OperandExpression<SqlBool>;
} & {
    AND?: OrArray<WhereInput<Schema, Model, ScalarOnly>>;
    OR?: WhereInput<Schema, Model, ScalarOnly>[];
    NOT?: OrArray<WhereInput<Schema, Model, ScalarOnly>>;
};

type EnumFilter<Schema extends SchemaDef, T extends GetEnums<Schema>, Nullable extends boolean> =
    | NullableIf<keyof GetEnum<Schema, T>, Nullable>
    | {
          equals?: NullableIf<keyof GetEnum<Schema, T>, Nullable>;
          in?: (keyof GetEnum<Schema, T>)[];
          notIn?: (keyof GetEnum<Schema, T>)[];
          not?: EnumFilter<Schema, T, Nullable>;
      };

type ArrayFilter<T extends string> = {
    equals?: MapBaseType<T>[];
    has?: MapBaseType<T>;
    hasEvery?: MapBaseType<T>[];
    hasSome?: MapBaseType<T>[];
    isEmpty?: boolean;
};

type PrimitiveFilter<T extends string, Nullable extends boolean> = T extends 'String'
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

export type CommonPrimitiveFilter<DataType, T extends BuiltinType, Nullable extends boolean> = {
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

export type NumberFilter<T extends 'Int' | 'Float' | 'Decimal' | 'BigInt', Nullable extends boolean> =
    | NullableIf<number | bigint, Nullable>
    | CommonPrimitiveFilter<number, T, Nullable>;

export type DateTimeFilter<Nullable extends boolean> =
    | NullableIf<Date | string, Nullable>
    | CommonPrimitiveFilter<Date | string, 'DateTime', Nullable>;

export type BytesFilter<Nullable extends boolean> =
    | NullableIf<Uint8Array | Buffer, Nullable>
    | {
          equals?: NullableIf<Uint8Array, Nullable>;
          in?: Uint8Array[];
          notIn?: Uint8Array[];
          not?: BytesFilter<Nullable>;
      };
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
    Model extends GetModels<Schema>,
    WithRelation extends boolean,
    WithAggregation extends boolean,
> = {
    [Key in NonRelationFields<Schema, Model>]?: FieldIsOptional<Schema, Model, Key> extends true
        ?
              | SortOrder
              | {
                    sort: SortOrder;
                    nulls?: NullsOrder;
                }
        : SortOrder;
} & (WithRelation extends true
    ? {
          [Key in RelationFields<Schema, Model>]?: FieldIsArray<Schema, Model, Key> extends true
              ? {
                    _count?: SortOrder;
                }
              : OrderBy<Schema, RelationFieldType<Schema, Model, Key>, WithRelation, WithAggregation>;
      }
    : {}) &
    (WithAggregation extends true
        ? {
              _count?: OrderBy<Schema, Model, WithRelation, false>;
          } & (NumericFields<Schema, Model> extends never
              ? {}
              : {
                    _avg?: SumAvgInput<Schema, Model>;
                    _sum?: SumAvgInput<Schema, Model>;
                    _min?: MinMaxInput<Schema, Model>;
                    _max?: MinMaxInput<Schema, Model>;
                })
        : {});

export type WhereUniqueInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = AtLeast<
    {
        [Key in keyof GetModel<Schema, Model>['uniqueFields']]?: GetModel<
            Schema,
            Model
        >['uniqueFields'][Key] extends Pick<FieldDef, 'type'>
            ? MapFieldDefType<Schema, GetModel<Schema, Model>['uniqueFields'][Key]>
            : // multi-field unique
              {
                  [Key1 in keyof GetModel<Schema, Model>['uniqueFields'][Key]]: GetModel<
                      Schema,
                      Model
                  >['uniqueFields'][Key][Key1] extends Pick<FieldDef, 'type'>
                      ? MapFieldDefType<Schema, GetModel<Schema, Model>['uniqueFields'][Key][Key1]>
                      : never;
              };
    } & WhereInput<Schema, Model>,
    Extract<keyof GetModel<Schema, Model>['uniqueFields'], string>
>;

type OmitFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in NonRelationFields<Schema, Model>]?: true;
};

export type SelectIncludeOmit<Schema extends SchemaDef, Model extends GetModels<Schema>, AllowCount extends boolean> = {
    select?: Select<Schema, Model, AllowCount, boolean>;
    include?: Include<Schema, Model>;
    omit?: OmitFields<Schema, Model>;
};

type Distinct<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    distinct?: OrArray<NonRelationFields<Schema, Model>>;
};

type Cursor<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    cursor?: WhereUniqueInput<Schema, Model>;
};

type Select<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    AllowCount extends boolean,
    AllowRelation extends boolean = true,
> = {
    [Key in NonRelationFields<Schema, Model>]?: true;
} & (AllowRelation extends true ? Include<Schema, Model> : {}) & // relation fields
    // relation count
    (AllowCount extends true ? { _count?: SelectCount<Schema, Model> } : {});

type SelectCount<Schema extends SchemaDef, Model extends GetModels<Schema>> =
    | true
    | {
          select: {
              [Key in RelationFields<Schema, Model> as FieldIsArray<Schema, Model, Key> extends true ? Key : never]:
                  | true
                  | {
                        where: WhereInput<Schema, RelationFieldType<Schema, Model, Key>, false>;
                    };
          };
      };

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

export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
};

export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
} & (T extends { select: any; include: any }
    ? 'Please either choose `select` or `include`.'
    : T extends { select: any; omit: any }
      ? 'Please either choose `select` or `omit`.'
      : {});

type ToManyRelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = {
    every?: WhereInput<Schema, RelationFieldType<Schema, Model, Field>>;
    some?: WhereInput<Schema, RelationFieldType<Schema, Model, Field>>;
    none?: WhereInput<Schema, RelationFieldType<Schema, Model, Field>>;
};

type ToOneRelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = NullableIf<
    WhereInput<Schema, RelationFieldType<Schema, Model, Field>> & {
        is?: NullableIf<
            WhereInput<Schema, RelationFieldType<Schema, Model, Field>>,
            FieldIsOptional<Schema, Model, Field>
        >;
        isNot?: NullableIf<
            WhereInput<Schema, RelationFieldType<Schema, Model, Field>>,
            FieldIsOptional<Schema, Model, Field>
        >;
    },
    FieldIsOptional<Schema, Model, Field>
>;

type RelationFilter<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? ToManyRelationFilter<Schema, Model, Field>
        : ToOneRelationFilter<Schema, Model, Field>;

//#endregion

//#region Field utils

export type MapFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
> = MapFieldDefType<Schema, GetField<Schema, Model, Field>>;

type MapFieldDefType<Schema extends SchemaDef, T extends Pick<FieldDef, 'type' | 'optional' | 'array'>> = WrapType<
    T['type'] extends GetEnums<Schema> ? keyof GetEnum<Schema, T['type']> : MapBaseType<T['type']>,
    T['optional'],
    T['array']
>;

export type OptionalFieldsForCreate<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetFields<Schema, Model> as FieldIsOptional<Schema, Model, Key> extends true
        ? Key
        : FieldHasDefault<Schema, Model, Key> extends true
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
    Field extends GetFields<Schema, Model>,
> = GetField<Schema, Model, Field>['relation'];

type OppositeRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>,
> =
    FT extends GetModels<Schema>
        ? GetRelation<Schema, Model, Field> extends RelationInfo
            ? GetRelation<Schema, Model, Field>['opposite'] extends GetFields<Schema, FT>
                ? Schema['models'][FT]['fields'][GetRelation<Schema, Model, Field>['opposite']]['relation']
                : never
            : never
        : never;

export type OppositeRelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    Opposite = OppositeRelation<Schema, Model, Field>,
> = Opposite extends RelationInfo ? (Opposite['fields'] extends string[] ? Opposite['fields'] : []) : [];

export type OppositeRelationAndFK<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>,
    Relation = GetField<Schema, Model, Field>['relation'],
    Opposite = Relation extends RelationInfo ? Relation['opposite'] : never,
> =
    FT extends GetModels<Schema>
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
    AllowFilter extends boolean = true,
> = (Collection extends true
    ? {
          skip?: number;
          take?: number;
          orderBy?: OrArray<OrderBy<Schema, Model, true, false>>;
      }
    : {}) &
    (AllowFilter extends true
        ? {
              where?: WhereInput<Schema, Model>;
          }
        : {}) &
    SelectIncludeOmit<Schema, Model, Collection> &
    Distinct<Schema, Model> &
    Cursor<Schema, Model>;

export type FindUniqueArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where?: WhereUniqueInput<Schema, Model>;
} & SelectIncludeOmit<Schema, Model, true>;

//#endregion

//#region Create args

export type CreateArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    data: CreateInput<Schema, Model>;
    select?: Select<Schema, Model, true>;
    include?: Include<Schema, Model>;
    omit?: OmitFields<Schema, Model>;
};

export type CreateManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateManyPayload<
    Schema,
    Model
>;

export type CreateManyAndReturnArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateManyPayload<
    Schema,
    Model
> & {
    select?: Select<Schema, Model, false, false>;
    omit?: OmitFields<Schema, Model>;
};

type OptionalWrap<Schema extends SchemaDef, Model extends GetModels<Schema>, T extends object> = Optional<
    T,
    keyof T & OptionalFieldsForCreate<Schema, Model>
>;

type CreateScalarPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ScalarFields<Schema, Model, false>]: ScalarCreatePayload<Schema, Model, Key>;
    }
>;

type ScalarCreatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends ScalarFields<Schema, Model, false>,
> =
    | MapFieldType<Schema, Model, Field>
    | (FieldIsArray<Schema, Model, Field> extends true
          ? {
                set?: MapFieldType<Schema, Model, Field>[];
            }
          : never);

type CreateFKPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ForeignKeyFields<Schema, Model>]: MapFieldType<Schema, Model, Key>;
    }
>;

type CreateRelationFieldPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
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

type CreateRelationPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in RelationFields<Schema, Model>]: CreateRelationFieldPayload<Schema, Model, Key>;
    }
>;

type CreateWithFKInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateScalarPayload<Schema, Model> &
    CreateFKPayload<Schema, Model>;

type CreateWithRelationInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateScalarPayload<
    Schema,
    Model
> &
    CreateRelationPayload<Schema, Model>;

type ConnectOrCreatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = {
    where: WhereUniqueInput<Schema, Model>;
    create: CreateInput<Schema, Model, Without>;
};

type CreateManyPayload<Schema extends SchemaDef, Model extends GetModels<Schema>, Without extends string = never> = {
    data: OrArray<Omit<CreateScalarPayload<Schema, Model>, Without> & Omit<CreateFKPayload<Schema, Model>, Without>>;
    skipDuplicates?: boolean;
};

export type CreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = XOR<Omit<CreateWithFKInput<Schema, Model>, Without>, Omit<CreateWithRelationInput<Schema, Model>, Without>>;

type NestedCreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = OrArray<
    CreateInput<Schema, RelationFieldType<Schema, Model, Field>, OppositeRelationAndFK<Schema, Model, Field>>,
    FieldIsArray<Schema, Model, Field>
>;

type NestedCreateManyInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = CreateManyPayload<Schema, RelationFieldType<Schema, Model, Field>, OppositeRelationAndFK<Schema, Model, Field>>;

//#endregion

// #region Update args

export type UpdateArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    data: UpdateInput<Schema, Model>;
    where: WhereUniqueInput<Schema, Model>;
    select?: Select<Schema, Model, true>;
    include?: Include<Schema, Model>;
    omit?: OmitFields<Schema, Model>;
};

export type UpdateManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = UpdateManyPayload<
    Schema,
    Model
>;

export type UpdateManyAndReturnArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = UpdateManyPayload<
    Schema,
    Model
> & {
    select?: Select<Schema, Model, false, false>;
    omit?: OmitFields<Schema, Model>;
};

type UpdateManyPayload<Schema extends SchemaDef, Model extends GetModels<Schema>, Without extends string = never> = {
    data: OrArray<UpdateScalarInput<Schema, Model, Without>>;
    where?: WhereInput<Schema, Model>;
    limit?: number;
};

export type UpsertArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    create: CreateInput<Schema, Model>;
    update: UpdateInput<Schema, Model>;
    where: WhereUniqueInput<Schema, Model>;
    select?: Select<Schema, Model, true>;
    include?: Include<Schema, Model>;
    omit?: OmitFields<Schema, Model>;
};

export type UpdateScalarInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = Omit<
    {
        [Key in NonRelationFields<Schema, Model>]?: ScalarUpdatePayload<Schema, Model, Key>;
    },
    Without
>;

type ScalarUpdatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends NonRelationFields<Schema, Model>,
> =
    | MapFieldType<Schema, Model, Field>
    | (Field extends NumericFields<Schema, Model>
          ? {
                set?: NullableIf<number, FieldIsOptional<Schema, Model, Field>>;
                increment?: number;
                decrement?: number;
                multiply?: number;
                divide?: number;
            }
          : never)
    | (FieldIsArray<Schema, Model, Field> extends true
          ? {
                set?: MapFieldType<Schema, Model, Field>[];
                push?: OrArray<MapFieldType<Schema, Model, Field>, true>;
            }
          : never);

export type UpdateRelationInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = Omit<
    {
        [Key in RelationFields<Schema, Model>]?: UpdateRelationFieldPayload<Schema, Model, Key>;
    },
    Without
>;

export type UpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = UpdateScalarInput<Schema, Model, Without> & UpdateRelationInput<Schema, Model, Without>;

type UpdateRelationFieldPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? ToManyRelationUpdateInput<Schema, Model, Field>
        : ToOneRelationUpdateInput<Schema, Model, Field>;

type ToManyRelationUpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = {
    create?: NestedCreateInput<Schema, Model, Field>;
    createMany?: NestedCreateManyInput<Schema, Model, Field>;
    connect?: ConnectInput<Schema, Model, Field>;
    connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
    disconnect?: DisconnectInput<Schema, Model, Field>;
    update?: NestedUpdateInput<Schema, Model, Field>;
    upsert?: NestedUpsertInput<Schema, Model, Field>;
    updateMany?: NestedUpdateManyInput<Schema, Model, Field>;
    delete?: NestedDeleteInput<Schema, Model, Field>;
    deleteMany?: NestedDeleteManyInput<Schema, Model, Field>;
    set?: SetRelationInput<Schema, Model, Field>;
};

type ToOneRelationUpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = {
    create?: NestedCreateInput<Schema, Model, Field>;
    connect?: ConnectInput<Schema, Model, Field>;
    connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
    update?: NestedUpdateInput<Schema, Model, Field>;
    upsert?: NestedUpsertInput<Schema, Model, Field>;
} & (FieldIsOptional<Schema, Model, Field> extends true
    ? {
          disconnect?: DisconnectInput<Schema, Model, Field>;
          delete?: NestedDeleteInput<Schema, Model, Field>;
      }
    : {});

// #endregion

// #region Delete args

export type DeleteArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where: WhereUniqueInput<Schema, Model>;
    select?: Select<Schema, Model, true>;
    include?: Include<Schema, Model>;
    omit?: OmitFields<Schema, Model>;
};

export type DeleteManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where?: WhereInput<Schema, Model>;
    limit?: number;
};

// #endregion

// #region Count args

export type CountArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = Omit<
    FindArgs<Schema, Model, true>,
    'select' | 'include' | 'distinct' | 'omit'
> & {
    select?: CountAggregateInput<Schema, Model> | true;
};

export type CountAggregateInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in NonRelationFields<Schema, Model>]?: true;
} & { _all?: true };

export type CountResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Args extends CountArgs<Schema, Model>,
> = Args extends { select: infer S }
    ? S extends true
        ? number
        : {
              [Key in keyof S]: number;
          }
    : number;

// #endregion

// #region Aggregate

export type AggregateArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where?: WhereInput<Schema, Model>;
    skip?: number;
    take?: number;
    orderBy?: OrArray<OrderBy<Schema, Model, true, false>>;
} & {
    _count?: true | CountAggregateInput<Schema, Model>;
} & (NumericFields<Schema, Model> extends never
        ? {}
        : {
              _avg?: SumAvgInput<Schema, Model>;
              _sum?: SumAvgInput<Schema, Model>;
              _min?: MinMaxInput<Schema, Model>;
              _max?: MinMaxInput<Schema, Model>;
          });

type NumericFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetFields<Schema, Model> as GetFieldType<Schema, Model, Key> extends 'Int' | 'Float' | 'BigInt' | 'Decimal'
        ? FieldIsArray<Schema, Model, Key> extends true
            ? never
            : Key
        : never]: GetField<Schema, Model, Key>;
};

type SumAvgInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in NumericFields<Schema, Model>]?: true;
};

type MinMaxInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in GetFields<Schema, Model> as FieldIsArray<Schema, Model, Key> extends true
        ? never
        : FieldIsRelation<Schema, Model, Key> extends true
          ? never
          : Key]?: true;
};

export type AggregateResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Args extends AggregateArgs<Schema, Model>,
> = (Args extends { _count: infer Count }
    ? {
          _count: AggCommonOutput<Count>;
      }
    : {}) &
    (Args extends { _sum: infer Sum }
        ? {
              _sum: AggCommonOutput<Sum>;
          }
        : {}) &
    (Args extends { _avg: infer Avg }
        ? {
              _avg: AggCommonOutput<Avg>;
          }
        : {}) &
    (Args extends { _min: infer Min }
        ? {
              _min: AggCommonOutput<Min>;
          }
        : {}) &
    (Args extends { _max: infer Max }
        ? {
              _max: AggCommonOutput<Max>;
          }
        : {});

type AggCommonOutput<Input> = Input extends true
    ? number
    : Input extends {}
      ? {
            [Key in keyof Input]: number;
        }
      : never;

// #endregion

// #region GroupBy

export type GroupByArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where?: WhereInput<Schema, Model>;
    orderBy?: OrArray<OrderBy<Schema, Model, false, true>>;
    by: NonRelationFields<Schema, Model> | NonEmptyArray<NonRelationFields<Schema, Model>>;
    having?: WhereInput<Schema, Model, true>;
    take?: number;
    skip?: number;
    _count?: true | CountAggregateInput<Schema, Model>;
} & (NumericFields<Schema, Model> extends never
    ? {}
    : {
          _avg?: SumAvgInput<Schema, Model>;
          _sum?: SumAvgInput<Schema, Model>;
          _min?: MinMaxInput<Schema, Model>;
          _max?: MinMaxInput<Schema, Model>;
      });

export type GroupByResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Args extends GroupByArgs<Schema, Model>,
> = Array<
    {
        [Key in NonRelationFields<Schema, Model> as Key extends ValueOfPotentialTuple<Args['by']>
            ? Key
            : never]: MapFieldType<Schema, Model, Key>;
    } & (Args extends { _count: infer Count }
        ? {
              _count: AggCommonOutput<Count>;
          }
        : {}) &
        (Args extends { _avg: infer Avg }
            ? {
                  _avg: AggCommonOutput<Avg>;
              }
            : {}) &
        (Args extends { _sum: infer Sum }
            ? {
                  _sum: AggCommonOutput<Sum>;
              }
            : {}) &
        (Args extends { _min: infer Min }
            ? {
                  _min: AggCommonOutput<Min>;
              }
            : {}) &
        (Args extends { _max: infer Max }
            ? {
                  _max: AggCommonOutput<Max>;
              }
            : {})
>;

// #endregion

// #region Relation manipulation

type ConnectInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? OrArray<WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>>
        : WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>;

type ConnectOrCreateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? OrArray<
              ConnectOrCreatePayload<
                  Schema,
                  RelationFieldType<Schema, Model, Field>,
                  OppositeRelationAndFK<Schema, Model, Field>
              >
          >
        : ConnectOrCreatePayload<
              Schema,
              RelationFieldType<Schema, Model, Field>,
              OppositeRelationAndFK<Schema, Model, Field>
          >;

type DisconnectInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? OrArray<WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>, true>
        : boolean | WhereInput<Schema, RelationFieldType<Schema, Model, Field>>;

type SetRelationInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = OrArray<WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>>;

type NestedUpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? OrArray<
              {
                  where: WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>;
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
                  where: WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>;
                  data: UpdateInput<
                      Schema,
                      RelationFieldType<Schema, Model, Field>,
                      OppositeRelationAndFK<Schema, Model, Field>
                  >;
              },
              UpdateInput<Schema, RelationFieldType<Schema, Model, Field>, OppositeRelationAndFK<Schema, Model, Field>>
          >;

type NestedUpsertInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = OrArray<
    {
        where: WhereUniqueInput<Schema, Model>;
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
    Field extends RelationFields<Schema, Model>,
> = OrArray<
    UpdateManyPayload<Schema, RelationFieldType<Schema, Model, Field>, OppositeRelationAndFK<Schema, Model, Field>>
>;

type NestedDeleteInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> =
    FieldIsArray<Schema, Model, Field> extends true
        ? OrArray<WhereUniqueInput<Schema, RelationFieldType<Schema, Model, Field>>, true>
        : boolean | WhereInput<Schema, RelationFieldType<Schema, Model, Field>>;

type NestedDeleteManyInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = OrArray<WhereInput<Schema, RelationFieldType<Schema, Model, Field>, true>>;

// #endregion

//#region Client API

export interface ModelOperations<Schema extends SchemaDef, Model extends GetModels<Schema>> {
    /**
     * Returns a list of entities.
     * @param args - query args
     * @returns a list of entities
     *
     * @example
     * ```ts
     * // find all users and return all scalar fields
     * await client.user.findMany();
     *
     * // find all users with name 'Alex'
     * await client.user.findMany({
     *     where: {
     *         name: 'Alex'
     *     }
     * });
     *
     * // select fields
     * await client.user.findMany({
     *     select: {
     *         name: true,
     *         email: true,
     *     }
     * }); // result: `Array<{ name: string, email: string }>`
     *
     * // omit fields
     * await client.user.findMany({
     *     omit: {
     *         name: true,
     *     }
     * }); // result: `Array<{ id: number; email: string; ... }>`
     *
     * // include relations (and all scalar fields)
     * await client.user.findMany({
     *     include: {
     *         posts: true,
     *     }
     * }); // result: `Array<{ ...; posts: Post[] }>`
     *
     * // include relations with filter
     * await client.user.findMany({
     *     include: {
     *         posts: {
     *             where: {
     *                 published: true
     *             }
     *         }
     *     }
     * });
     *
     * // pagination and sorting
     * await client.user.findMany({
     *     skip: 10,
     *     take: 10,
     *     orderBy: [{ name: 'asc' }, { email: 'desc' }],
     * });
     *
     * // pagination with cursor (https://www.prisma.io/docs/orm/prisma-client/queries/pagination#cursor-based-pagination)
     * await client.user.findMany({
     *     cursor: { id: 10 },
     *     skip: 1,
     *     take: 10,
     *     orderBy: { id: 'asc' },
     * });
     *
     * // distinct
     * await client.user.findMany({
     *     distinct: ['name']
     * });
     *
     * // count all relations
     * await client.user.findMany({
     *     _count: true,
     * }); // result: `{ _count: { posts: number; ... } }`
     *
     * // count selected relations
     * await client.user.findMany({
     *     _count: { select: { posts: true } },
     * }); // result: `{ _count: { posts: number } }`
     * ```
     */
    findMany<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): Promise<ModelResult<Schema, Model, T>[]>;

    /**
     * Returns a uniquely identified entity.
     * @param args - query args
     * @returns a single entity or null if not found
     * @see {@link findMany}
     */
    findUnique<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T> | null>;

    /**
     * Returns a uniquely identified entity or throws `NotFoundError` if not found.
     * @param args - query args
     * @returns a single entity
     * @see {@link findMany}
     */
    findUniqueOrThrow<T extends FindUniqueArgs<Schema, Model>>(
        args?: SelectSubset<T, FindUniqueArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>>;

    /**
     * Returns the first entity.
     * @param args - query args
     * @returns a single entity or null if not found
     * @see {@link findMany}
     */
    findFirst<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): Promise<ModelResult<Schema, Model, T> | null>;

    /**
     * Returns the first entity or throws `NotFoundError` if not found.
     * @param args - query args
     * @returns a single entity
     * @see {@link findMany}
     */
    findFirstOrThrow<T extends FindArgs<Schema, Model, true>>(
        args?: SelectSubset<T, FindArgs<Schema, Model, true>>,
    ): Promise<ModelResult<Schema, Model, T>>;

    /**
     * Creates a new entity.
     * @param args - create args
     * @returns the created entity
     *
     * @example
     * ```ts
     * // simple create
     * await client.user.create({
     *    data: { name: 'Alex', email: 'alex@zenstack.dev' }
     * });
     *
     * // nested create with relation
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { create: { title: 'Hello World' } }
     *    }
     * });
     *
     * // you can use `select`, `omit`, and `include` to control
     * // the fields returned by the query, as with `findMany`
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { create: { title: 'Hello World' } }
     *    },
     *    include: { posts: true }
     * }); // result: `{ id: number; posts: Post[] }`
     *
     * // connect relations
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: { connect: { id: 1 } }
     *    }
     * });
     *
     * // connect relations, and create if not found
     * await client.user.create({
     *    data: {
     *        email: 'alex@zenstack.dev',
     *        posts: {
     *            connectOrCreate: {
     *                where: { id: 1 },
     *                create: { title: 'Hello World' }
     *            }
     *        }
     *    }
     * });
     * ```
     */
    create<T extends CreateArgs<Schema, Model>>(
        args: SelectSubset<T, CreateArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>>;

    /**
     * Creates multiple entities. Only scalar fields are allowed.
     * @param args - create args
     * @returns count of created entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // create multiple entities
     * await client.user.createMany({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ]
     * });
     *
     * // skip items that cause unique constraint violation
     * await client.user.createMany({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ],
     *     skipDuplicates: true
     * });
     * ```
     */
    createMany(args?: CreateManyPayload<Schema, Model>): Promise<BatchResult>;

    /**
     * Creates multiple entities and returns them.
     * @param args - create args. See {@link createMany} for input. Use
     * `select` and `omit` to control the fields returned.
     * @returns the created entities
     *
     * @example
     * ```ts
     * // create multiple entities and return selected fields
     * await client.user.createManyAndReturn({
     *     data: [
     *         { name: 'Alex', email: 'alex@zenstack.dev' },
     *         { name: 'John', email: 'john@zenstack.dev' }
     *     ],
     *     select: { id: true, email: true }
     * });
     * ```
     */
    createManyAndReturn<T extends CreateManyAndReturnArgs<Schema, Model>>(
        args?: SelectSubset<T, CreateManyAndReturnArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>[]>;

    /**
     * Updates a uniquely identified entity.
     * @param args - update args. See {@link findMany} for how to control
     * fields and relations returned.
     * @returns the updated entity. Throws `NotFoundError` if the entity is not found.
     *
     * @example
     * ```ts
     * // update fields
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { name: 'Alex' }
     * });
     *
     * // connect a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { connect: { id: 1 } } }
     * });
     *
     * // connect relation, and create if not found
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *            connectOrCreate: {
     *                where: { id: 1 },
     *                create: { title: 'Hello World' }
     *            }
     *         }
     *     }
     * });
     *
     * // create many related entities (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             createMany: {
     *                 data: [{ title: 'Hello World' }, { title: 'Hello World 2' }],
     *             }
     *         }
     *     }
     * });
     *
     * // disconnect a one-to-many relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { disconnect: { id: 1 } } }
     * });
     *
     * // disconnect a one-to-one relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { profile: { disconnect: true } }
     * });
     *
     * // replace a relation (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             set: [{ id: 1 }, { id: 2 }]
     *         }
     *     }
     * });
     *
     * // update a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             update: { where: { id: 1 }, data: { title: 'Hello World' } }
     *         }
     *     }
     * });
     *
     * // upsert a relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             upsert: {
     *                 where: { id: 1 },
     *                 create: { title: 'Hello World' },
     *                 update: { title: 'Hello World' }
     *             }
     *         }
     *     }
     * });
     *
     * // update many related entities (only available for one-to-many relations)
     * await client.user.update({
     *     where: { id: 1 },
     *     data: {
     *         posts: {
     *             updateMany: {
     *                 where: { published: true },
     *                 data: { title: 'Hello World' }
     *             }
     *         }
     *     }
     * });
     *
     * // delete a one-to-many relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { posts: { delete: { id: 1 } } }
     * });
     *
     * // delete a one-to-one relation
     * await client.user.update({
     *     where: { id: 1 },
     *     data: { profile: { delete: true } }
     * });
     * ```
     */
    update<T extends UpdateArgs<Schema, Model>>(
        args: SelectSubset<T, UpdateArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>>;

    /**
     * Updates multiple entities.
     * @param args - update args. Only scalar fields are allowed for data.
     * @returns count of updated entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // update many entities
     * await client.user.updateMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' }
     * });
     *
     * // limit the number of updated entities
     * await client.user.updateMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     limit: 10
     * });
     */
    updateMany<T extends UpdateManyArgs<Schema, Model>>(
        args: Subset<T, UpdateManyArgs<Schema, Model>>,
    ): Promise<BatchResult>;

    /**
     * Updates multiple entities and returns them.
     * @param args - update args. Only scalar fields are allowed for data.
     * @returns the updated entities
     *
     * @example
     * ```ts
     * // update many entities and return selected fields
     * await client.user.updateManyAndReturn({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     select: { id: true, email: true }
     * }); // result: `Array<{ id: string; email: string }>`
     *
     * // limit the number of updated entities
     * await client.user.updateManyAndReturn({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     data: { role: 'ADMIN' },
     *     limit: 10
     * });
     * ```
     */
    updateManyAndReturn<T extends UpdateManyAndReturnArgs<Schema, Model>>(
        args: Subset<T, UpdateManyAndReturnArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>[]>;

    /**
     * Creates or updates an entity.
     * @param args - upsert args
     * @returns the upserted entity
     *
     * @example
     * ```ts
     * // upsert an entity
     * await client.user.upsert({
     *     // `where` clause is used to find the entity
     *     where: { id: 1 },
     *     // `create` clause is used if the entity is not found
     *     create: { email: 'alex@zenstack.dev', name: 'Alex' },
     *     // `update` clause is used if the entity is found
     *     update: { name: 'Alex-new' },
     *     // `select` and `omit` can be used to control the returned fields
     *     ...
     * });
     * ```
     */
    upsert<T extends UpsertArgs<Schema, Model>>(
        args: SelectSubset<T, UpsertArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model, T>>;

    /**
     * Deletes a uniquely identifiable entity.
     * @param args - delete args
     * @returns the deleted entity. Throws `NotFoundError` if the entity is not found.
     *
     * @example
     * ```ts
     * // delete an entity
     * await client.user.delete({
     *     where: { id: 1 }
     * });
     *
     * // delete an entity and return selected fields
     * await client.user.delete({
     *     where: { id: 1 },
     *     select: { id: true, email: true }
     * }); // result: `{ id: string; email: string }`
     * ```
     */
    delete<T extends DeleteArgs<Schema, Model>>(
        args: SelectSubset<T, DeleteArgs<Schema, Model>>,
    ): Promise<ModelResult<Schema, Model>>;

    /**
     * Deletes multiple entities.
     * @param args - delete args
     * @returns count of deleted entities: `{ count: number }`
     *
     * @example
     * ```ts
     * // delete many entities
     * await client.user.deleteMany({
     *     where: { email: { endsWith: '@zenstack.dev' } }
     * });
     *
     * // limit the number of deleted entities
     * await client.user.deleteMany({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     limit: 10
     * });
     * ```
     */
    deleteMany<T extends DeleteManyArgs<Schema, Model>>(
        args?: Subset<T, DeleteManyArgs<Schema, Model>>,
    ): Promise<BatchResult>;

    /**
     * Counts rows or field values.
     * @param args - count args
     * @returns `number`, or an object containing count of selected relations
     *
     * @example
     * ```ts
     * // count all
     * await client.user.count();
     *
     * // count with a filter
     * await client.user.count({ where: { email: { endsWith: '@zenstack.dev' } } });
     *
     * // count rows and field values
     * await client.user.count({
     *     select: { _all: true, email: true }
     * }); // result: `{ _all: number, email: number }`
     */
    count<T extends CountArgs<Schema, Model>>(
        args?: Subset<T, CountArgs<Schema, Model>>,
    ): Promise<CountResult<Schema, Model, T>>;

    /**
     * Aggregates rows.
     * @param args - aggregation args
     * @returns an object containing aggregated values
     *
     * @example
     * ```ts
     * // aggregate rows
     * await client.profile.aggregate({
     *     where: { email: { endsWith: '@zenstack.dev' } },
     *     _count: true,
     *     _avg: { age: true },
     *     _sum: { age: true },
     *     _min: { age: true },
     *     _max: { age: true }
     * }); // result: `{ _count: number, _avg: { age: number }, ... }`
     */
    aggregate<T extends AggregateArgs<Schema, Model>>(
        args: Subset<T, AggregateArgs<Schema, Model>>,
    ): Promise<AggregateResult<Schema, Model, T>>;

    /**
     * Groups rows by columns.
     * @param args - groupBy args
     * @returns an object containing grouped values
     *
     * @example
     * ```ts
     * // group by a field
     * await client.profile.groupBy({
     *     by: 'country',
     *     _count: true
     * }); // result: `Array<{ country: string, _count: number }>`
     *
     * // group by multiple fields
     * await client.profile.groupBy({
     *     by: ['country', 'city'],
     *     _count: true
     * }); // result: `Array<{ country: string, city: string, _count: number }>`
     *
     * // group by with sorting, the `orderBy` fields must be in the `by` list
     * await client.profile.groupBy({
     *     by: 'country',
     *     orderBy: { country: 'desc' }
     * });
     *
     * // group by with having (post-aggregation filter), the `having` fields must
     * // be in the `by` list
     * await client.profile.groupBy({
     *     by: 'country',
     *     having: { country: 'US' }
     * });
     */
    groupBy<T extends GroupByArgs<Schema, Model>>(
        args: Subset<T, GroupByArgs<Schema, Model>>,
    ): Promise<GroupByResult<Schema, Model, T>>;
}

//#endregion
