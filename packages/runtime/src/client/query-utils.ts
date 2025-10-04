import { invariant } from '@zenstackhq/common-helpers';
import {
    AliasNode,
    ColumnNode,
    ReferenceNode,
    TableNode,
    type Expression,
    type ExpressionBuilder,
    type ExpressionWrapper,
    type OperationNode,
} from 'kysely';
import { match } from 'ts-pattern';
import { ExpressionUtils, type FieldDef, type GetModels, type ModelDef, type SchemaDef } from '../schema';
import { extractFields } from '../utils/object-utils';
import type { AGGREGATE_OPERATORS } from './constants';
import type { OrderBy } from './crud-types';
import { InternalError, QueryError } from './errors';
import type { ClientOptions } from './options';

export function hasModel(schema: SchemaDef, model: string) {
    return Object.keys(schema.models)
        .map((k) => k.toLowerCase())
        .includes(model.toLowerCase());
}

export function getModel(schema: SchemaDef, model: string) {
    return Object.values(schema.models).find((m) => m.name.toLowerCase() === model.toLowerCase());
}

export function getTypeDef(schema: SchemaDef, type: string) {
    return schema.typeDefs?.[type];
}

export function requireModel(schema: SchemaDef, model: string) {
    const modelDef = getModel(schema, model);
    if (!modelDef) {
        throw new QueryError(`Model "${model}" not found in schema`);
    }
    return modelDef;
}

export function getField(schema: SchemaDef, model: string, field: string) {
    const modelDef = getModel(schema, model);
    return modelDef?.fields[field];
}

export function requireField(schema: SchemaDef, modelOrType: string, field: string) {
    const modelDef = getModel(schema, modelOrType);
    if (modelDef) {
        if (!modelDef.fields[field]) {
            throw new QueryError(`Field "${field}" not found in model "${modelOrType}"`);
        } else {
            return modelDef.fields[field];
        }
    }
    const typeDef = getTypeDef(schema, modelOrType);
    if (typeDef) {
        if (!typeDef.fields[field]) {
            throw new QueryError(`Field "${field}" not found in type "${modelOrType}"`);
        } else {
            return typeDef.fields[field];
        }
    }
    throw new QueryError(`Model or type "${modelOrType}" not found in schema`);
}

export function getIdFields<Schema extends SchemaDef>(schema: SchemaDef, model: GetModels<Schema>) {
    const modelDef = getModel(schema, model);
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

export function getRelationForeignKeyFieldPairs(schema: SchemaDef, model: string, relationField: string) {
    const fieldDef = requireField(schema, model, relationField);

    if (!fieldDef?.relation) {
        throw new InternalError(`Field "${relationField}" is not a relation`);
    }

    if (fieldDef.relation.fields) {
        if (!fieldDef.relation.references) {
            throw new InternalError(`Relation references not defined for field "${relationField}"`);
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
            throw new InternalError(`Opposite relation not defined for field "${relationField}"`);
        }

        const oppositeField = requireField(schema, fieldDef.type, fieldDef.relation.opposite);

        if (!oppositeField.relation) {
            throw new InternalError(`Field "${fieldDef.relation.opposite}" is not a relation`);
        }
        if (!oppositeField.relation.fields) {
            throw new InternalError(`Relation fields not defined for field "${relationField}"`);
        }
        if (!oppositeField.relation.references) {
            throw new InternalError(`Relation references not defined for field "${relationField}"`);
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

export function isScalarField(schema: SchemaDef, model: string, field: string): boolean {
    const fieldDef = getField(schema, model, field);
    return !fieldDef?.relation && !fieldDef?.foreignKeyFor;
}

export function isForeignKeyField(schema: SchemaDef, model: string, field: string): boolean {
    const fieldDef = getField(schema, model, field);
    return !!fieldDef?.foreignKeyFor;
}

export function isRelationField(schema: SchemaDef, model: string, field: string): boolean {
    const fieldDef = getField(schema, model, field);
    return !!fieldDef?.relation;
}

export function isInheritedField(schema: SchemaDef, model: string, field: string): boolean {
    const fieldDef = getField(schema, model, field);
    return !!fieldDef?.originModel;
}

export function getUniqueFields(schema: SchemaDef, model: string) {
    const modelDef = requireModel(schema, model);
    const result: Array<
        // single field unique
        | { name: string; def: FieldDef }
        // multi-field unique
        | { name: string; defs: Record<string, FieldDef> }
    > = [];
    for (const [key, value] of Object.entries(modelDef.uniqueFields)) {
        if (typeof value !== 'object') {
            throw new InternalError(`Invalid unique field definition for "${key}"`);
        }

        if (typeof value.type === 'string') {
            // singular unique field
            result.push({ name: key, def: requireField(schema, model, key) });
        } else {
            // compound unique field
            result.push({
                name: key,
                defs: Object.fromEntries(Object.keys(value).map((k) => [k, requireField(schema, model, k)])),
            });
        }
    }
    return result;
}

export function getIdValues(schema: SchemaDef, model: string, data: any): Record<string, any> {
    const idFields = getIdFields(schema, model);
    if (!idFields) {
        throw new InternalError(`ID fields not defined for model "${model}"`);
    }
    return idFields.reduce((acc, field) => ({ ...acc, [field]: data[field] }), {});
}

export function buildFieldRef<Schema extends SchemaDef>(
    schema: Schema,
    model: string,
    field: string,
    options: ClientOptions<Schema>,
    eb: ExpressionBuilder<any, any>,
    modelAlias?: string,
    inlineComputedField = true,
): ExpressionWrapper<any, any, unknown> {
    const fieldDef = requireField(schema, model, field);
    if (!fieldDef.computed) {
        return eb.ref(modelAlias ? `${modelAlias}.${field}` : field);
    } else {
        if (!inlineComputedField) {
            return eb.ref(modelAlias ? `${modelAlias}.${field}` : field);
        }
        let computer: Function | undefined;
        if ('computedFields' in options) {
            const computedFields = options.computedFields as Record<string, any>;
            computer = computedFields?.[model]?.[field];
        }
        if (!computer) {
            throw new QueryError(`Computed field "${field}" implementation not provided for model "${model}"`);
        }
        return computer(eb, { modelAlias });
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
    relationModelAlias: string,
): [string, string][] {
    const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(schema, model, relationField);

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

export function makeDefaultOrderBy<Schema extends SchemaDef>(schema: SchemaDef, model: string) {
    const idFields = requireIdFields(schema, model);
    return idFields.map((f) => ({ [f]: 'asc' }) as OrderBy<Schema, GetModels<Schema>, true, false>);
}

export function getManyToManyRelation(schema: SchemaDef, model: string, field: string) {
    const fieldDef = requireField(schema, model, field);
    if (!fieldDef.array || !fieldDef.relation?.opposite) {
        return undefined;
    }
    const oppositeFieldDef = requireField(schema, fieldDef.type, fieldDef.relation.opposite);
    if (oppositeFieldDef.array) {
        // Prisma's convention for many-to-many relation:
        // - model are sorted alphabetically by name
        // - join table is named _<model1>To<model2>, unless an explicit name is provided by `@relation`
        // - foreign keys are named A and B (based on the order of the model)
        const sortedModelNames = [model, fieldDef.type].sort();

        let orderedFK: [string, string];
        if (model !== fieldDef.type) {
            // not a self-relation, model name's sort order determines fk order
            orderedFK = sortedModelNames[0] === model ? ['A', 'B'] : ['B', 'A'];
        } else {
            // for self-relations, since model names are identical, relation field name's
            // sort order determines fk order
            const sortedFieldNames = [field, oppositeFieldDef.name].sort();
            orderedFK = sortedFieldNames[0] === field ? ['A', 'B'] : ['B', 'A'];
        }

        const modelIdFields = requireIdFields(schema, model);
        invariant(modelIdFields.length === 1, 'Only single-field ID is supported for many-to-many relation');
        const otherIdFields = requireIdFields(schema, fieldDef.type);
        invariant(otherIdFields.length === 1, 'Only single-field ID is supported for many-to-many relation');

        return {
            parentFkName: orderedFK[0],
            parentPKName: modelIdFields[0]!,
            otherModel: fieldDef.type,
            otherField: fieldDef.relation.opposite,
            otherFkName: orderedFK[1],
            otherPKName: otherIdFields[0]!,
            joinTable: fieldDef.relation.name
                ? `_${fieldDef.relation.name}`
                : `_${sortedModelNames[0]}To${sortedModelNames[1]}`,
        };
    } else {
        return undefined;
    }
}

/**
 * Convert filter like `{ id1_id2: { id1: 1, id2: 1 } }` to `{ id1: 1, id2: 1 }`
 */
export function flattenCompoundUniqueFilters(schema: SchemaDef, model: string, filter: unknown) {
    if (typeof filter !== 'object' || !filter) {
        return filter;
    }

    const uniqueFields = getUniqueFields(schema, model);
    const compoundUniques = uniqueFields.filter((u) => 'defs' in u);
    if (compoundUniques.length === 0) {
        return filter;
    }

    const result: any = {};
    for (const [key, value] of Object.entries(filter)) {
        if (compoundUniques.some(({ name }) => name === key)) {
            // flatten the compound field
            Object.assign(result, value);
        } else {
            result[key] = value;
        }
    }
    return result;
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

export function extractIdFields(entity: any, schema: SchemaDef, model: string) {
    const idFields = requireIdFields(schema, model);
    return extractFields(entity, idFields);
}

export function getDiscriminatorField(schema: SchemaDef, model: string) {
    const modelDef = requireModel(schema, model);
    const delegateAttr = modelDef.attributes?.find((attr) => attr.name === '@@delegate');
    if (!delegateAttr) {
        return undefined;
    }
    const discriminator = delegateAttr.args?.find((arg) => arg.name === 'discriminator');
    if (!discriminator || !ExpressionUtils.isField(discriminator.value)) {
        throw new InternalError(`Discriminator field not defined for model "${model}"`);
    }
    return discriminator.value.field;
}

export function getDelegateDescendantModels(
    schema: SchemaDef,
    model: string,
    collected: Set<ModelDef> = new Set<ModelDef>(),
): ModelDef[] {
    const subModels = Object.values(schema.models).filter((m) => m.baseModel === model);
    subModels.forEach((def) => {
        if (!collected.has(def)) {
            collected.add(def);
            getDelegateDescendantModels(schema, def.name, collected);
        }
    });
    return [...collected];
}

export function aggregate(eb: ExpressionBuilder<any, any>, expr: Expression<any>, op: AGGREGATE_OPERATORS) {
    return match(op)
        .with('_count', () => eb.fn.count(expr))
        .with('_sum', () => eb.fn.sum(expr))
        .with('_avg', () => eb.fn.avg(expr))
        .with('_min', () => eb.fn.min(expr))
        .with('_max', () => eb.fn.max(expr))
        .exhaustive();
}

/**
 * Strips alias from the node if it exists.
 */
export function stripAlias(node: OperationNode) {
    if (AliasNode.is(node)) {
        return { alias: node.alias, node: node.node };
    } else {
        return { alias: undefined, node };
    }
}

/**
 * Extracts model name from an OperationNode.
 */
export function extractModelName(node: OperationNode) {
    const { node: innerNode } = stripAlias(node);
    return TableNode.is(innerNode!) ? innerNode!.table.identifier.name : undefined;
}

/**
 * Extracts field name from an OperationNode.
 */
export function extractFieldName(node: OperationNode) {
    if (ReferenceNode.is(node) && ColumnNode.is(node.column)) {
        return node.column.column.name;
    } else if (ColumnNode.is(node)) {
        return node.column.name;
    } else {
        return undefined;
    }
}
