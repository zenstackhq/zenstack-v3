import type { FieldDef, SchemaDef } from '@zenstackhq/schema';

/**
 * Helper to create a mock schema for testing
 */
export function createSchema(models: SchemaDef['models']): SchemaDef {
    return {
        provider: { type: 'postgresql' },
        models,
        plugins: {},
    };
}

/**
 * Helper to create a field definition
 */
export function createField(name: string, type: string, optional = false): FieldDef {
    return {
        name,
        type,
        optional,
    };
}

/**
 * Helper to create a relation field
 */
export function createRelationField(name: string, type: string, optional = false): FieldDef {
    return {
        name,
        type,
        optional,
        relation: {
            opposite: 'user',
        },
    };
}
