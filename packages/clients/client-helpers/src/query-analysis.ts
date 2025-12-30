import type { SchemaDef } from '@zenstackhq/schema';
import { NestedReadVisitor } from './nested-read-visitor';
import { NestedWriteVisitor } from './nested-write-visitor';
import type { ORMWriteActionType } from './types';

/**
 * Gets models read (including nested ones) given a query args.
 */
export function getReadModels(model: string, schema: SchemaDef, args: any) {
    const result = new Set<string>();
    result.add(model);
    const visitor = new NestedReadVisitor(schema, {
        field: (model) => {
            result.add(model);
            return true;
        },
    });
    visitor.visit(model, args);
    return [...result];
}

/**
 * Gets mutated models (including nested ones) given a mutation args.
 */
export async function getMutatedModels(
    model: string,
    operation: ORMWriteActionType,
    mutationArgs: any,
    schema: SchemaDef,
) {
    const result = new Set<string>();
    result.add(model);

    if (mutationArgs) {
        const addModel = (model: string) => void result.add(model);

        // add models that are cascaded deleted recursively
        const addCascades = (model: string) => {
            const cascades = new Set<string>();
            const visited = new Set<string>();
            collectDeleteCascades(model, schema, cascades, visited);
            cascades.forEach((m) => addModel(m));
        };

        const visitor = new NestedWriteVisitor(schema, {
            create: addModel,
            createMany: addModel,
            connectOrCreate: addModel,
            connect: addModel,
            disconnect: addModel,
            set: addModel,
            update: addModel,
            updateMany: addModel,
            upsert: addModel,
            delete: (model) => {
                addModel(model);
                addCascades(model);
            },
            deleteMany: (model) => {
                addModel(model);
                addCascades(model);
            },
        });
        await visitor.visit(model, operation, mutationArgs);
    }

    // include delegate base models recursively
    result.forEach((m) => {
        getBaseRecursively(m, schema, result);
    });

    return [...result];
}

function collectDeleteCascades(model: string, schema: SchemaDef, result: Set<string>, visited: Set<string>) {
    if (visited.has(model)) {
        // break circle
        return;
    }
    visited.add(model);

    const modelDef = schema.models[model];
    if (!modelDef) {
        return;
    }

    for (const [modelName, modelDef] of Object.entries(schema.models)) {
        if (!modelDef) {
            continue;
        }
        for (const fieldDef of Object.values(modelDef.fields)) {
            if (fieldDef.relation?.onDelete === 'Cascade' && fieldDef.type === model) {
                if (!result.has(modelName)) {
                    result.add(modelName);
                }
                collectDeleteCascades(modelName, schema, result, visited);
            }
        }
    }
}

function getBaseRecursively(model: string, schema: SchemaDef, result: Set<string>) {
    const modelDef = schema.models[model];
    if (!modelDef) {
        return;
    }
    if (modelDef.baseModel) {
        result.add(modelDef.baseModel);
        getBaseRecursively(modelDef.baseModel, schema, result);
    }
}
