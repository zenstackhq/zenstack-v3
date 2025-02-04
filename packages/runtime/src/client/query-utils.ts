import { Effect } from 'effect';
import type { FieldDef, ModelDef, SchemaDef } from '../schema/schema';
import { InternalError, QueryError } from './errors';

export function hasModel(schema: SchemaDef, model: string) {
    return Object.keys(schema.models)
        .map((k) => k.toLowerCase())
        .includes(model.toLowerCase());
}

export function requireModel(schema: SchemaDef, model: string) {
    const matchedName = Object.keys(schema.models).find(
        (k) => k.toLowerCase() === model.toLowerCase()
    );
    if (!matchedName) {
        throw new QueryError(`Model "${model}" not found`);
    }
    return schema.models[matchedName]!;
}

export function requireModelEffect(
    schema: SchemaDef,
    model: string
): Effect.Effect<ModelDef, Error, never> {
    return Effect.try({
        try: () => requireModel(schema, model),
        catch: () => new QueryError(`Model "${model}" not found`),
    });
}

export function requireField(schema: SchemaDef, model: string, field: string) {
    const modelDef = requireModel(schema, model);
    if (!modelDef.fields[field]) {
        throw new QueryError(`Field "${field}" not found in model "${model}"`);
    }
    return modelDef.fields[field];
}

export function getIdFields(schema: SchemaDef, model: string) {
    const modelDef = requireModel(schema, model);
    return modelDef?.idFields;
}

export function requireIdFields(schema: SchemaDef, model: string) {
    const modelDef = requireModel(schema, model);
    const result = modelDef?.idFields;
    if (!result) {
        throw new InternalError(`Model "${model}" does not have ID field(s)`);
    }
    return result;
}

export function getRelationForeignKeyFieldPairs(
    schema: SchemaDef,
    model: string,
    relationField: string
) {
    const fieldDef = requireField(schema, model, relationField);

    if (!fieldDef?.relation) {
        throw new InternalError(`Field "${relationField}" is not a relation`);
    }

    if (fieldDef.relation.fields) {
        if (!fieldDef.relation.references) {
            throw new InternalError(
                `Relation references not defined for field "${relationField}"`
            );
        }
        // the model owns the relation
        return fieldDef.relation.fields.map((f, i) => ({
            fk: f,
            pk: fieldDef.relation!.references![i]!,
        }));
    } else {
        // the opposite model owns the relation
        if (!fieldDef.relation.opposite) {
            throw new InternalError(
                `Opposite relation not defined for field "${relationField}"`
            );
        }

        const oppositeField = requireField(
            schema,
            fieldDef.type,
            fieldDef.relation.opposite
        );

        if (!oppositeField.relation) {
            throw new InternalError(
                `Field "${fieldDef.relation.opposite}" is not a relation`
            );
        }
        if (!oppositeField.relation.fields) {
            throw new InternalError(
                `Relation fields not defined for field "${relationField}"`
            );
        }
        if (!oppositeField.relation.references) {
            throw new InternalError(
                `Relation references not defined for field "${relationField}"`
            );
        }

        return oppositeField.relation.fields.map((f, i) => ({
            fk: f,
            pk: oppositeField.relation!.references![i]!,
        }));
    }
}

export function isScalarField(
    schema: SchemaDef,
    model: string,
    field: string
): boolean {
    const fieldDef = requireField(schema, model, field);
    return !fieldDef.relation && !fieldDef.foreignKeyFor;
}

export function isForeignKeyField(
    schema: SchemaDef,
    model: string,
    field: string
): boolean {
    const fieldDef = requireField(schema, model, field);
    return !!fieldDef.foreignKeyFor;
}

export function getUniqueFields(schema: SchemaDef, model: string) {
    const modelDef = requireModel(schema, model);
    const result: Array<{ name: string; def: FieldDef }[]> = [];
    for (const [key, value] of Object.entries(modelDef.uniqueFields)) {
        if (typeof value !== 'object') {
            throw new InternalError(
                `Invalid unique field definition for "${key}"`
            );
        }

        if (typeof value.type === 'string') {
            // singular unique field
            result.push([{ name: key, def: requireField(schema, model, key) }]);
        } else {
            // compound unique field
            result.push(
                Object.keys(value).map((k) => ({
                    name: k,
                    def: requireField(schema, model, k),
                }))
            );
        }
    }
    return result;
}

export function getIdValues(
    schema: SchemaDef,
    model: string,
    data: any
): Record<string, any> {
    const idFields = getIdFields(schema, model);
    if (!idFields) {
        throw new InternalError(`ID fields not defined for model "${model}"`);
    }
    return idFields.reduce(
        (acc, field) => ({ ...acc, [field]: data[field] }),
        {}
    );
}
