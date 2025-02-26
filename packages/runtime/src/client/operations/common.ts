import type { Kysely } from 'kysely';
import type { GetFields, GetModels, SchemaDef } from '../../schema';
import type { ToKysely } from '../query-builder';
import { getIdFields, requireModel } from '../query-utils';

export function exists<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(
    kysely: Kysely<ToKysely<Schema>>,
    schema: Schema,
    model: Model,
    filter: any
): Promise<Partial<Record<GetFields<Schema, Model>, any>> | undefined> {
    const modelDef = requireModel(schema, model);
    const idFields = getIdFields(schema, model);
    return kysely
        .selectFrom(modelDef.dbTable)
        .where((eb) => eb.and(filter))
        .select(idFields.map((f) => kysely.dynamic.ref(f)))
        .limit(1)
        .executeTakeFirst();
}
