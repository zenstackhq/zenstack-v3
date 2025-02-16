import type {
    ZodBoolean,
    ZodNumber,
    ZodObject,
    ZodString,
    ZodUnknown,
} from 'zod';
import type { FieldType, SchemaDef } from '../schema';
import type { GetModels, ScalarFields } from '../schema/schema';

export interface ZodSchemas<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> {
    select(): SelectSchema<Schema, Model>;
}

export type SelectSchema<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
> = ZodObject<{
    [Key in ScalarFields<Schema, Model>]: MapScalarType<Schema, Model, Key>;
}>;

type MapScalarType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends ScalarFields<Schema, Model>,
    Type = FieldType<Schema, Model, Field>
> = Type extends 'String'
    ? ZodString
    : Type extends 'Int'
    ? ZodNumber
    : Type extends 'BigInt'
    ? ZodNumber
    : Type extends 'Float'
    ? ZodNumber
    : Type extends 'Decimal'
    ? ZodNumber
    : Type extends 'DateTime'
    ? ZodString
    : Type extends 'Boolean'
    ? ZodBoolean
    : ZodUnknown;
