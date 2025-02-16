import { Match } from 'effect';
import { z, ZodSchema } from 'zod';
import { requireModel } from '../client/query-utils';
import type { SchemaDef } from '../schema';
import type { FieldDef, GetModels } from '../schema/schema';
import type { SelectSchema, ZodSchemas } from './types';

export function makeZodSchemas<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(schema: Schema, model: Model): ZodSchemas<Schema, Model> {
    return {
        select: () => {
            return z.object(mapFields(schema, model)) as SelectSchema<
                Schema,
                typeof model
            >;
        },
    };
}

function mapFields<Schema extends SchemaDef>(
    schema: Schema,
    model: GetModels<Schema>
): any {
    const modelDef = requireModel(schema, model);
    const scalarFields = Object.entries(modelDef.fields).filter(
        ([_, fieldDef]) => !fieldDef.relation
    );
    const result: Record<string, ZodSchema> = {};
    for (const [field, fieldDef] of scalarFields) {
        result[field] = makeScalarSchema(fieldDef);
    }
    return result;
}

function makeScalarSchema(
    fieldDef: FieldDef
): z.ZodType<any, z.ZodTypeDef, any> {
    return Match.value(fieldDef.type).pipe(
        Match.when('String', () => z.string()),
        Match.whenOr('Int', 'BigInt', 'Float', 'Decimal', () => z.number()),
        Match.when('Boolean', () => z.boolean()),
        Match.when('DateTime', () => z.string().datetime()),
        Match.orElse(() => z.unknown())
    );
}
