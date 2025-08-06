import type { ExpressionBuilder, OperandExpression, SqlBool } from 'kysely';
import type {
    BuiltinType,
    FieldDef,
    FieldHasDefault,
    FieldIsArray,
    FieldIsDelegateDiscriminator,
    FieldIsDelegateRelation,
    FieldIsRelation,
    FieldIsRelationArray,
    FieldType,
    ForeignKeyFields,
    GetEnum,
    GetEnums,
    GetModel,
    GetModelDiscriminator,
    GetModelField,
    GetModelFields,
    GetModelFieldType,
    GetModels,
    GetSubModels,
    GetTypeDefField,
    GetTypeDefFields,
    GetTypeDefs,
    IsDelegateModel,
    ModelFieldIsOptional,
    NonRelationFields,
    RelationFields,
    RelationFieldType,
    RelationInfo,
    ScalarFields,
    SchemaDef,
    TypeDefFieldIsOptional,
} from '../schema';
import type {
    AtLeast,
    MapBaseType,
    NonEmptyArray,
    NullableIf,
    Optional,
    OrArray,
    Simplify,
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
    IsDelegateModel<Schema, Model> extends true
        ? // delegate model's selection result is a union of all sub-models
          DelegateUnionResult<Schema, Model, GetSubModels<Schema, Model>, Omit>
        : {
              [Key in NonRelationFields<Schema, Model> as Key extends keyof Omit
                  ? Omit[Key] extends true
                      ? never
                      : Key
                  : Key]: MapModelFieldType<Schema, Model, Key>;
          },
    Optional,
    Array
>;

type DelegateUnionResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    SubModel extends GetModels<Schema>,
    Omit = undefined,
> = SubModel extends string // typescript union distribution
    ? DefaultModelResult<Schema, SubModel, Omit> & { [K in GetModelDiscriminator<Schema, Model>]: SubModel } // fixate discriminated field
    : never;

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
          ? MapModelFieldType<Schema, Model, Key>
          : Key extends RelationFields<Schema, Model>
            ? Select[Key] extends FindArgs<
                  Schema,
                  RelationFieldType<Schema, Model, Key>,
                  FieldIsArray<Schema, Model, Key>
              >
                ? 'select' extends keyof Select[Key]
                    ? ModelResult<
                          Schema,
                          RelationFieldType<Schema, Model, Key>,
                          Pick<Select[Key], 'select'>,
                          ModelFieldIsOptional<Schema, Model, Key>,
                          FieldIsArray<Schema, Model, Key>
                      >
                    : ModelResult<
                          Schema,
                          RelationFieldType<Schema, Model, Key>,
                          Pick<Select[Key], 'include' | 'omit'>,
                          ModelFieldIsOptional<Schema, Model, Key>,
                          FieldIsArray<Schema, Model, Key>
                      >
                : DefaultModelResult<
                      Schema,
                      RelationFieldType<Schema, Model, Key>,
                      Omit,
                      ModelFieldIsOptional<Schema, Model, Key>,
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
                          ModelFieldIsOptional<Schema, Model, Key>,
                          FieldIsArray<Schema, Model, Key>
                      >
                    : DefaultModelResult<
                          Schema,
                          RelationFieldType<Schema, Model, Key>,
                          undefined,
                          ModelFieldIsOptional<Schema, Model, Key>,
                          FieldIsArray<Schema, Model, Key>
                      >;
            }
          : Args extends { omit: infer O }
            ? DefaultModelResult<Schema, Model, O>
            : DefaultModelResult<Schema, Model>,
    Optional,
    Array
>;

export type SimplifiedModelResult<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Args extends SelectIncludeOmit<Schema, Model, boolean> = {},
    Optional = false,
    Array = false,
> = Simplify<ModelResult<Schema, Model, Args, Optional, Array>>;

export type TypeDefResult<Schema extends SchemaDef, TypeDef extends GetTypeDefs<Schema>> = Optional<
    {
        [Key in GetTypeDefFields<Schema, TypeDef>]: MapTypeDefFieldType<Schema, TypeDef, Key>;
    },
    // optionality
    keyof {
        [Key in GetTypeDefFields<Schema, TypeDef> as TypeDefFieldIsOptional<Schema, TypeDef, Key> extends true
            ? Key
            : never]: true;
    }
>;

export type BatchResult = { count: number };

//#endregion

//#region Common structures

export type WhereInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    ScalarOnly extends boolean = false,
> = {
    [Key in GetModelFields<Schema, Model> as ScalarOnly extends true
        ? Key extends RelationFields<Schema, Model>
            ? never
            : Key
        : Key]?: Key extends RelationFields<Schema, Model>
        ? // relation
          RelationFilter<Schema, Model, Key>
        : // enum
          GetModelFieldType<Schema, Model, Key> extends GetEnums<Schema>
          ? EnumFilter<Schema, GetModelFieldType<Schema, Model, Key>, ModelFieldIsOptional<Schema, Model, Key>>
          : FieldIsArray<Schema, Model, Key> extends true
            ? ArrayFilter<GetModelFieldType<Schema, Model, Key>>
            : // primitive
              PrimitiveFilter<Schema, GetModelFieldType<Schema, Model, Key>, ModelFieldIsOptional<Schema, Model, Key>>;
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

type PrimitiveFilter<Schema extends SchemaDef, T extends string, Nullable extends boolean> = T extends 'String'
    ? StringFilter<Schema, Nullable>
    : T extends 'Int' | 'Float' | 'Decimal' | 'BigInt'
      ? NumberFilter<Schema, T, Nullable>
      : T extends 'Boolean'
        ? BooleanFilter<Nullable>
        : T extends 'DateTime'
          ? DateTimeFilter<Schema, Nullable>
          : T extends 'Bytes'
            ? BytesFilter<Nullable>
            : T extends 'Json'
              ? 'Not implemented yet' // TODO: Json filter
              : never;

type CommonPrimitiveFilter<Schema extends SchemaDef, DataType, T extends BuiltinType, Nullable extends boolean> = {
    equals?: NullableIf<DataType, Nullable>;
    in?: DataType[];
    notIn?: DataType[];
    lt?: DataType;
    lte?: DataType;
    gt?: DataType;
    gte?: DataType;
    not?: PrimitiveFilter<Schema, T, Nullable>;
};

export type StringFilter<Schema extends SchemaDef, Nullable extends boolean> =
    | NullableIf<string, Nullable>
    | (CommonPrimitiveFilter<Schema, string, 'String', Nullable> & {
          contains?: string;
          startsWith?: string;
          endsWith?: string;
      } & (ProviderSupportsCaseSensitivity<Schema> extends true
              ? {
                    mode?: 'default' | 'insensitive';
                }
              : {}));

export type NumberFilter<
    Schema extends SchemaDef,
    T extends 'Int' | 'Float' | 'Decimal' | 'BigInt',
    Nullable extends boolean,
> = NullableIf<number | bigint, Nullable> | CommonPrimitiveFilter<Schema, number, T, Nullable>;

export type DateTimeFilter<Schema extends SchemaDef, Nullable extends boolean> =
    | NullableIf<Date | string, Nullable>
    | CommonPrimitiveFilter<Schema, Date | string, 'DateTime', Nullable>;

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
    [Key in NonRelationFields<Schema, Model>]?: ModelFieldIsOptional<Schema, Model, Key> extends true
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

export type OmitInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in NonRelationFields<Schema, Model>]?: true;
};

export type SelectIncludeOmit<Schema extends SchemaDef, Model extends GetModels<Schema>, AllowCount extends boolean> = {
    select?: SelectInput<Schema, Model, AllowCount, boolean>;
    include?: IncludeInput<Schema, Model>;
    omit?: OmitInput<Schema, Model>;
};

type Distinct<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    distinct?: OrArray<NonRelationFields<Schema, Model>>;
};

type Cursor<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    cursor?: WhereUniqueInput<Schema, Model>;
};

export type SelectInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    AllowCount extends boolean = true,
    AllowRelation extends boolean = true,
> = {
    [Key in NonRelationFields<Schema, Model>]?: true;
} & (AllowRelation extends true ? IncludeInput<Schema, Model> : {}) & // relation fields
    // relation count
    (AllowCount extends true
        ? // _count is only allowed if the model has to-many relations
          HasToManyRelations<Schema, Model> extends true
            ? { _count?: SelectCount<Schema, Model> }
            : {}
        : {});

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

export type IncludeInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in RelationFields<Schema, Model>]?:
        | boolean
        | FindArgs<
              Schema,
              RelationFieldType<Schema, Model, Key>,
              FieldIsArray<Schema, Model, Key>,
              // where clause is allowed only if the relation is array or optional
              FieldIsArray<Schema, Model, Key> extends true
                  ? true
                  : ModelFieldIsOptional<Schema, Model, Key> extends true
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
            ModelFieldIsOptional<Schema, Model, Field>
        >;
        isNot?: NullableIf<
            WhereInput<Schema, RelationFieldType<Schema, Model, Field>>,
            ModelFieldIsOptional<Schema, Model, Field>
        >;
    },
    ModelFieldIsOptional<Schema, Model, Field>
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

type MapModelFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = MapFieldDefType<Schema, GetModelField<Schema, Model, Field>>;

type MapTypeDefFieldType<
    Schema extends SchemaDef,
    TypeDef extends GetTypeDefs<Schema>,
    Field extends GetTypeDefFields<Schema, TypeDef>,
> = MapFieldDefType<Schema, GetTypeDefField<Schema, TypeDef, Field>>;

type MapFieldDefType<Schema extends SchemaDef, T extends Pick<FieldDef, 'type' | 'optional' | 'array'>> = WrapType<
    T['type'] extends GetEnums<Schema>
        ? keyof GetEnum<Schema, T['type']>
        : T['type'] extends GetTypeDefs<Schema>
          ? TypeDefResult<Schema, T['type']> & Record<string, unknown>
          : MapBaseType<T['type']>,
    T['optional'],
    T['array']
>;

type OptionalFieldsForCreate<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in GetModelFields<Schema, Model> as ModelFieldIsOptional<Schema, Model, Key> extends true
        ? Key
        : FieldHasDefault<Schema, Model, Key> extends true
          ? Key
          : GetModelField<Schema, Model, Key>['updatedAt'] extends true
            ? Key
            : FieldIsRelationArray<Schema, Model, Key> extends true
              ? Key
              : never]: GetModelField<Schema, Model, Key>;
};

type GetRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
> = GetModelField<Schema, Model, Field>['relation'];

type OppositeRelation<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>,
> =
    FT extends GetModels<Schema>
        ? GetRelation<Schema, Model, Field> extends RelationInfo
            ? GetRelation<Schema, Model, Field>['opposite'] extends GetModelFields<Schema, FT>
                ? Schema['models'][FT]['fields'][GetRelation<Schema, Model, Field>['opposite']]['relation']
                : never
            : never
        : never;

type OppositeRelationFields<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
    Opposite = OppositeRelation<Schema, Model, Field>,
> = Opposite extends RelationInfo ? (Opposite['fields'] extends string[] ? Opposite['fields'] : []) : [];

type OppositeRelationAndFK<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetModelFields<Schema, Model>,
    FT = FieldType<Schema, Model, Field>,
    Relation = GetModelField<Schema, Model, Field>['relation'],
    Opposite = Relation extends RelationInfo ? Relation['opposite'] : never,
> =
    FT extends GetModels<Schema>
        ? Opposite extends GetModelFields<Schema, FT>
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

export type FindManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = FindArgs<Schema, Model, true>;
export type FindFirstArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = FindArgs<Schema, Model, false>;

export type FindUniqueArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where?: WhereUniqueInput<Schema, Model>;
} & SelectIncludeOmit<Schema, Model, true>;

//#endregion

//#region Create args

export type CreateArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    data: CreateInput<Schema, Model>;
    select?: SelectInput<Schema, Model, true>;
    include?: IncludeInput<Schema, Model>;
    omit?: OmitInput<Schema, Model>;
};

export type CreateManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateManyInput<Schema, Model>;

export type CreateManyAndReturnArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateManyInput<
    Schema,
    Model
> & {
    select?: SelectInput<Schema, Model, false, false>;
    omit?: OmitInput<Schema, Model>;
};

type OptionalWrap<Schema extends SchemaDef, Model extends GetModels<Schema>, T extends object> = Optional<
    T,
    keyof T & OptionalFieldsForCreate<Schema, Model>
>;

type CreateScalarPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ScalarFields<Schema, Model, false> as FieldIsDelegateDiscriminator<Schema, Model, Key> extends true
            ? // discriminator fields cannot be assigned
              never
            : Key]: ScalarCreatePayload<Schema, Model, Key>;
    }
>;

type ScalarCreatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends ScalarFields<Schema, Model, false>,
> =
    | MapModelFieldType<Schema, Model, Field>
    | (FieldIsArray<Schema, Model, Field> extends true
          ? {
                set?: MapModelFieldType<Schema, Model, Field>[];
            }
          : never);

type CreateFKPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in ForeignKeyFields<Schema, Model>]: MapModelFieldType<Schema, Model, Key>;
    }
>;

type CreateRelationFieldPayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = Omit<
    {
        connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
        create?: NestedCreateInput<Schema, Model, Field>;
        createMany?: NestedCreateManyInput<Schema, Model, Field>;
        connect?: ConnectInput<Schema, Model, Field>;
    },
    // no "createMany" for non-array fields
    | (FieldIsArray<Schema, Model, Field> extends true ? never : 'createMany')
    // exclude operations not applicable to delegate models
    | (FieldIsDelegateRelation<Schema, Model, Field> extends true ? 'create' | 'createMany' | 'connectOrCreate' : never)
>;

type CreateRelationPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in RelationFields<Schema, Model>]: CreateRelationFieldPayload<Schema, Model, Key>;
    }
>;

type CreateWithFKInput<Schema extends SchemaDef, Model extends GetModels<Schema>> =
    // scalar fields
    CreateScalarPayload<Schema, Model> &
        // fk fields
        CreateFKPayload<Schema, Model> &
        // non-owned relations
        CreateWithNonOwnedRelationPayload<Schema, Model>;

type CreateWithRelationInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = CreateScalarPayload<
    Schema,
    Model
> &
    CreateRelationPayload<Schema, Model>;

type CreateWithNonOwnedRelationPayload<Schema extends SchemaDef, Model extends GetModels<Schema>> = OptionalWrap<
    Schema,
    Model,
    {
        [Key in NonOwnedRelationFields<Schema, Model>]: CreateRelationFieldPayload<Schema, Model, Key>;
    }
>;

type ConnectOrCreatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = {
    where: WhereUniqueInput<Schema, Model>;
    create: CreateInput<Schema, Model, Without>;
};

type CreateManyInput<Schema extends SchemaDef, Model extends GetModels<Schema>, Without extends string = never> = {
    data: OrArray<Omit<CreateScalarPayload<Schema, Model>, Without> & Omit<CreateFKPayload<Schema, Model>, Without>>;
    skipDuplicates?: boolean;
};

type CreateInput<Schema extends SchemaDef, Model extends GetModels<Schema>, Without extends string = never> = XOR<
    Omit<CreateWithFKInput<Schema, Model>, Without>,
    Omit<CreateWithRelationInput<Schema, Model>, Without>
>;

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
> = CreateManyInput<Schema, RelationFieldType<Schema, Model, Field>, OppositeRelationAndFK<Schema, Model, Field>>;

//#endregion

// #region Update args

export type UpdateArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    data: UpdateInput<Schema, Model>;
    where: WhereUniqueInput<Schema, Model>;
    select?: SelectInput<Schema, Model, true>;
    include?: IncludeInput<Schema, Model>;
    omit?: OmitInput<Schema, Model>;
};

export type UpdateManyArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = UpdateManyPayload<
    Schema,
    Model
>;

export type UpdateManyAndReturnArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = UpdateManyPayload<
    Schema,
    Model
> & {
    select?: SelectInput<Schema, Model, false, false>;
    omit?: OmitInput<Schema, Model>;
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
    select?: SelectInput<Schema, Model, true>;
    include?: IncludeInput<Schema, Model>;
    omit?: OmitInput<Schema, Model>;
};

type UpdateScalarInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = Omit<
    {
        [Key in NonRelationFields<Schema, Model> as FieldIsDelegateDiscriminator<Schema, Model, Key> extends true
            ? // discriminator fields cannot be assigned
              never
            : Key]?: ScalarUpdatePayload<Schema, Model, Key>;
    },
    Without
>;

type ScalarUpdatePayload<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends NonRelationFields<Schema, Model>,
> =
    | MapModelFieldType<Schema, Model, Field>
    | (Field extends NumericFields<Schema, Model>
          ? {
                set?: NullableIf<number, ModelFieldIsOptional<Schema, Model, Field>>;
                increment?: number;
                decrement?: number;
                multiply?: number;
                divide?: number;
            }
          : never)
    | (FieldIsArray<Schema, Model, Field> extends true
          ? {
                set?: MapModelFieldType<Schema, Model, Field>[];
                push?: OrArray<MapModelFieldType<Schema, Model, Field>, true>;
            }
          : never);

type UpdateRelationInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Without extends string = never,
> = Omit<
    {
        [Key in RelationFields<Schema, Model>]?: UpdateRelationFieldPayload<Schema, Model, Key>;
    },
    Without
>;

type UpdateInput<
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
> = Omit<
    {
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
    },
    // exclude
    FieldIsDelegateRelation<Schema, Model, Field> extends true
        ? 'create' | 'createMany' | 'connectOrCreate' | 'upsert'
        : never
>;

type ToOneRelationUpdateInput<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends RelationFields<Schema, Model>,
> = Omit<
    {
        create?: NestedCreateInput<Schema, Model, Field>;
        connect?: ConnectInput<Schema, Model, Field>;
        connectOrCreate?: ConnectOrCreateInput<Schema, Model, Field>;
        update?: NestedUpdateInput<Schema, Model, Field>;
        upsert?: NestedUpsertInput<Schema, Model, Field>;
    } & (ModelFieldIsOptional<Schema, Model, Field> extends true
        ? {
              disconnect?: DisconnectInput<Schema, Model, Field>;
              delete?: NestedDeleteInput<Schema, Model, Field>;
          }
        : {}),
    FieldIsDelegateRelation<Schema, Model, Field> extends true ? 'create' | 'connectOrCreate' | 'upsert' : never
>;

// #endregion

// #region Delete args

export type DeleteArgs<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    where: WhereUniqueInput<Schema, Model>;
    select?: SelectInput<Schema, Model, true>;
    include?: IncludeInput<Schema, Model>;
    omit?: OmitInput<Schema, Model>;
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

type CountAggregateInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
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
    [Key in GetModelFields<Schema, Model> as GetModelFieldType<Schema, Model, Key> extends
        | 'Int'
        | 'Float'
        | 'BigInt'
        | 'Decimal'
        ? FieldIsArray<Schema, Model, Key> extends true
            ? never
            : Key
        : never]: GetModelField<Schema, Model, Key>;
};

type SumAvgInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in NumericFields<Schema, Model>]?: true;
};

type MinMaxInput<Schema extends SchemaDef, Model extends GetModels<Schema>> = {
    [Key in GetModelFields<Schema, Model> as FieldIsArray<Schema, Model, Key> extends true
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
            : never]: MapModelFieldType<Schema, Model, Key>;
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

// #region Utilities

type NonOwnedRelationFields<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in RelationFields<Schema, Model> as GetModelField<Schema, Model, Key>['relation'] extends {
        references: unknown[];
    }
        ? never
        : Key]: true;
};

type HasToManyRelations<Schema extends SchemaDef, Model extends GetModels<Schema>> = keyof {
    [Key in RelationFields<Schema, Model> as FieldIsArray<Schema, Model, Key> extends true ? Key : never]: true;
} extends never
    ? false
    : true;

type ProviderSupportsCaseSensitivity<Schema extends SchemaDef> = Schema['provider'] extends 'postgresql' ? true : false;

// #endregion
