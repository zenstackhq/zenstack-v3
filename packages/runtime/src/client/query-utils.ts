import type { ExpressionBuilder, ExpressionWrapper } from 'kysely';
import type { FieldDef, GetModels, SchemaDef } from '../schema/schema';
import type { OrderBy } from './crud-types';
import { InternalError, QueryError } from './errors';
import type { ClientOptions } from './options';

export function hasModel(schema: SchemaDef, model: string) {
    return Object.keys(schema.models)
        .map((k) => k.toLowerCase())
        .includes(model.toLowerCase());
}

export function getModel(schema: SchemaDef, model: string) {
    return schema.models[model];
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

export function getField(schema: SchemaDef, model: string, field: string) {
    const modelDef = getModel(schema, model);
    return modelDef?.fields[field];
}

export function requireField(schema: SchemaDef, model: string, field: string) {
    const modelDef = requireModel(schema, model);
    if (!modelDef.fields[field]) {
        throw new QueryError(`Field "${field}" not found in model "${model}"`);
    }
    return modelDef.fields[field];
}

export function getIdFields<Schema extends SchemaDef>(
    schema: SchemaDef,
    model: GetModels<Schema>
) {
    const modelDef = requireModel(schema, model);
    return modelDef?.idFields as GetModels<Schema>[];
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
        // this model owns the fk
        return {
            keyPairs: fieldDef.relation.fields.map((f, i) => ({
                fk: f,
                pk: fieldDef.relation!.references![i]!,
            })),
            ownedByModel: true,
        };
    } else {
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

        // the opposite model owns the fk
        return {
            keyPairs: oppositeField.relation.fields.map((f, i) => ({
                fk: f,
                pk: oppositeField.relation!.references![i]!,
            })),
            ownedByModel: false,
        };
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

export function isRelationField(
    schema: SchemaDef,
    model: string,
    field: string
): boolean {
    const fieldDef = requireField(schema, model, field);
    return !!fieldDef.relation;
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

export function buildFieldRef<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    field: string,
    options: ClientOptions<Schema>,
    eb: ExpressionBuilder<any, any>,
    modelAlias?: string
): ExpressionWrapper<any, any, unknown> {
    const fieldDef = requireField(schema, model, field);
    if (!fieldDef.computed) {
        return eb.ref(modelAlias ? `${modelAlias}.${field}` : field);
    } else {
        let computer: Function | undefined;
        if ('computedFields' in options) {
            const computedFields = options.computedFields as Record<
                string,
                any
            >;
            computer = computedFields?.[model]?.[field];
        }
        if (!computer) {
            throw new QueryError(
                `Computed field "${field}" implementation not provided`
            );
        }
        return computer(eb);
    }
}

export function fieldHasDefaultValue(fieldDef: FieldDef) {
    return fieldDef.default !== undefined || fieldDef.updatedAt;
}

export function isEnum(schema: SchemaDef, type: string) {
    return !!schema.enums?.[type];
}

export function getEnum(schema: SchemaDef, type: string) {
    return schema.enums?.[type];
}

export function buildJoinPairs(
    schema: SchemaDef,
    model: string,
    modelAlias: string,
    relationField: string,
    relationModelAlias: string
): [string, string][] {
    const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
        schema,
        model,
        relationField
    );

    return keyPairs.map(({ fk, pk }) => {
        if (ownedByModel) {
            // the parent model owns the fk
            return [`${relationModelAlias}.${pk}`, `${modelAlias}.${fk}`];
        } else {
            // the relation side owns the fk
            return [`${relationModelAlias}.${fk}`, `${modelAlias}.${pk}`];
        }
    });
}

export function makeDefaultOrderBy<Schema extends SchemaDef>(
    schema: SchemaDef,
    model: string
) {
    const idFields = getIdFields(schema, model);
    return idFields.map(
        (f) =>
            ({ [f]: 'asc' } as OrderBy<Schema, GetModels<Schema>, true, false>)
    );
}

export function ensureArray<T>(value: T | T[]): T[] {
    if (Array.isArray(value)) {
        return value;
    } else {
        return [value];
    }
}

export function safeJSONStringify(value: unknown) {
    return JSON.stringify(value, (_, v) => {
        if (typeof v === 'bigint') {
            return v.toString();
        } else {
            return v;
        }
    });
}
