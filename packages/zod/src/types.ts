import type { FieldType, GetModels, ScalarFields, SchemaDef } from '@zenstackhq/orm/schema';
import type { ZodBoolean, ZodNumber, ZodObject, ZodString, ZodUnknown } from 'zod';

export type SelectSchema<Schema extends SchemaDef, Model extends GetModels<Schema>> = ZodObject<{
    [Key in ScalarFields<Schema, Model>]: MapScalarType<Schema, Model, Key>;
}>;

type MapScalarType<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>,
    Field extends ScalarFields<Schema, Model>,
    Type = FieldType<Schema, Model, Field>,
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
