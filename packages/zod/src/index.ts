import type {
    FieldDef,
    GetModels,
    SchemaDef,
} from '@zenstackhq/runtime/schema';
import { match, P } from 'ts-pattern';
import { z, ZodSchema } from 'zod';
import type { SelectSchema } from './types';

export function makeSelectSchema<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(schema: Schema, model: Model) {
    return z.object(mapFields(schema, model)) as SelectSchema<
        Schema,
        typeof model
    >;
}

function mapFields<Schema extends SchemaDef>(
    schema: Schema,
    model: GetModels<Schema>
): any {
    const modelDef = schema.models[model];
    if (!modelDef) {
        throw new Error(`Model ${model} not found in schema`);
    }
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
    return match(fieldDef.type)
        .with('String', () => z.string())
        .with(P.union('Int', 'BigInt', 'Float', 'Decimal'), () => z.number())
        .with('Boolean', () => z.boolean())
        .with('DateTime', () => z.string().datetime())
        .otherwise(() => z.unknown());
}
