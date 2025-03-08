import type Decimal from 'decimal.js';
import type { Generated, Kysely } from 'kysely';
import type {
    FieldHasDefault,
    FieldIsOptional,
    ForeignKeyFields,
    GetFields,
    GetFieldType,
    GetModels,
    ScalarFields,
    SchemaDef,
} from '../schema/schema';

export type ToKyselySchema<Schema extends SchemaDef> = {
    [Model in GetModels<Schema> as Schema['models'][Model]['dbTable']]: ToKyselyTable<
        Schema,
        Model
    >;
};

export type ToKysely<Schema extends SchemaDef> = Kysely<ToKyselySchema<Schema>>;

type ToKyselyTable<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = {
    [Field in
        | ScalarFields<Schema, Model>
        | ForeignKeyFields<Schema, Model>]: toKyselyFieldType<
        Schema,
        Model,
        Field
    >;
};

export type MapBaseType<T> = T extends 'String'
    ? string
    : T extends 'Boolean'
    ? boolean
    : T extends 'Int' | 'Float'
    ? number
    : T extends 'BigInt'
    ? bigint
    : T extends 'Decimal'
    ? Decimal
    : T extends 'DateTime'
    ? string
    : unknown;

type WrapNull<T, Null> = Null extends true ? T | null : T;

type MapType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = WrapNull<
    MapBaseType<GetFieldType<Schema, Model, Field>>,
    FieldIsOptional<Schema, Model, Field>
>;

type toKyselyFieldType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends GetFields<Schema, Model>
> = FieldHasDefault<Schema, Model, Field> extends true
    ? Generated<MapType<Schema, Model, Field>>
    : MapType<Schema, Model, Field>;
