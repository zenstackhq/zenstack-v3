import { definePlugin } from '@zenstackhq/orm';
import type { FieldDef, ModelDef, SchemaDef } from '@zenstackhq/orm/schema';
import { Decrypter } from './decrypter.js';
import { Encrypter } from './encrypter.js';
import type { CustomEncryption, EncryptionConfig, SimpleEncryption } from './types.js';
import { isCustomEncryption } from './types.js';

const ENCRYPTED_ATTRIBUTE = '@encrypted';

/**
 * Check if a field has the @encrypted attribute
 */
function isEncryptedField(field: FieldDef): boolean {
    return field.attributes?.some((attr) => attr.name === ENCRYPTED_ATTRIBUTE) ?? false;
}

/**
 * Check if a model has any encrypted fields
 */
function hasEncryptedFields(model: ModelDef): boolean {
    return Object.values(model.fields).some(isEncryptedField);
}

/**
 * Creates an encryption plugin for ZenStack ORM
 *
 * @param config Encryption configuration (simple or custom)
 * @returns A runtime plugin that handles field encryption/decryption
 */
export function createEncryptionPlugin<Schema extends SchemaDef>(config: EncryptionConfig) {
    let encrypter: Encrypter | undefined;
    let decrypter: Decrypter | undefined;
    let customEncryption: CustomEncryption | undefined;

    if (isCustomEncryption(config)) {
        customEncryption = config;
    } else {
        const simpleConfig = config as SimpleEncryption;
        encrypter = new Encrypter(simpleConfig.encryptionKey);
        const allDecryptionKeys = [simpleConfig.encryptionKey, ...(simpleConfig.decryptionKeys ?? [])];
        decrypter = new Decrypter(allDecryptionKeys);
    }

    async function encryptValue(model: string, field: FieldDef, value: string): Promise<string> {
        if (customEncryption) {
            return customEncryption.encrypt(model, field, value);
        }
        return encrypter!.encrypt(value);
    }

    async function decryptValue(model: string, field: FieldDef, value: string): Promise<string> {
        if (customEncryption) {
            return customEncryption.decrypt(model, field, value);
        }
        return decrypter!.decrypt(value);
    }

    /**
     * Recursively encrypt fields in write data
     */
    async function encryptWriteData(
        schema: SchemaDef,
        modelName: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const model = schema.models[modelName];
        if (!model) return;

        for (const [fieldName, value] of Object.entries(data)) {
            if (value === null || value === undefined || value === '') {
                continue;
            }

            const field = model.fields[fieldName];
            if (!field) continue;

            // Handle encrypted string fields
            if (isEncryptedField(field) && typeof value === 'string') {
                data[fieldName] = await encryptValue(modelName, field, value);
                continue;
            }

            // Handle relation fields (nested writes)
            if (field.relation && typeof value === 'object') {
                const relatedModel = field.type;
                await encryptNestedWrites(schema, relatedModel, value as Record<string, unknown>);
            }
        }
    }

    /**
     * Handle nested write operations (create, update, connect, etc.)
     */
    async function encryptNestedWrites(
        schema: SchemaDef,
        modelName: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        // Handle create
        const createData = data['create'];
        if (createData) {
            if (Array.isArray(createData)) {
                for (const item of createData) {
                    await encryptWriteData(schema, modelName, item as Record<string, unknown>);
                }
            } else {
                await encryptWriteData(schema, modelName, createData as Record<string, unknown>);
            }
        }

        // Handle createMany
        const createManyData = data['createMany'];
        if (createManyData && typeof createManyData === 'object') {
            const createManyItems = (createManyData as Record<string, unknown>)['data'];
            if (Array.isArray(createManyItems)) {
                for (const item of createManyItems) {
                    await encryptWriteData(schema, modelName, item as Record<string, unknown>);
                }
            }
        }

        // Handle update
        const updateData = data['update'];
        if (updateData) {
            if (Array.isArray(updateData)) {
                for (const item of updateData) {
                    const updateItem = item as Record<string, unknown>;
                    const itemData = updateItem['data'];
                    if (itemData) {
                        await encryptWriteData(schema, modelName, itemData as Record<string, unknown>);
                    }
                }
            } else {
                const updateObj = updateData as Record<string, unknown>;
                const nestedData = updateObj['data'];
                if (nestedData) {
                    await encryptWriteData(schema, modelName, nestedData as Record<string, unknown>);
                } else {
                    await encryptWriteData(schema, modelName, updateObj);
                }
            }
        }

        // Handle updateMany
        const updateManyData = data['updateMany'];
        if (updateManyData) {
            if (Array.isArray(updateManyData)) {
                for (const item of updateManyData) {
                    const updateItem = item as Record<string, unknown>;
                    const itemData = updateItem['data'];
                    if (itemData) {
                        await encryptWriteData(schema, modelName, itemData as Record<string, unknown>);
                    }
                }
            } else {
                const updateObj = updateManyData as Record<string, unknown>;
                const nestedData = updateObj['data'];
                if (nestedData) {
                    await encryptWriteData(schema, modelName, nestedData as Record<string, unknown>);
                }
            }
        }

        // Handle upsert
        const upsertData = data['upsert'];
        if (upsertData) {
            if (Array.isArray(upsertData)) {
                for (const item of upsertData) {
                    const upsertItem = item as Record<string, unknown>;
                    const createPart = upsertItem['create'];
                    const updatePart = upsertItem['update'];
                    if (createPart) {
                        await encryptWriteData(schema, modelName, createPart as Record<string, unknown>);
                    }
                    if (updatePart) {
                        await encryptWriteData(schema, modelName, updatePart as Record<string, unknown>);
                    }
                }
            } else {
                const upsertObj = upsertData as Record<string, unknown>;
                const createPart = upsertObj['create'];
                const updatePart = upsertObj['update'];
                if (createPart) {
                    await encryptWriteData(schema, modelName, createPart as Record<string, unknown>);
                }
                if (updatePart) {
                    await encryptWriteData(schema, modelName, updatePart as Record<string, unknown>);
                }
            }
        }

        // Handle connectOrCreate
        const connectOrCreateData = data['connectOrCreate'];
        if (connectOrCreateData) {
            if (Array.isArray(connectOrCreateData)) {
                for (const item of connectOrCreateData) {
                    const cocItem = item as Record<string, unknown>;
                    const createPart = cocItem['create'];
                    if (createPart) {
                        await encryptWriteData(schema, modelName, createPart as Record<string, unknown>);
                    }
                }
            } else {
                const cocObj = connectOrCreateData as Record<string, unknown>;
                const createPart = cocObj['create'];
                if (createPart) {
                    await encryptWriteData(schema, modelName, createPart as Record<string, unknown>);
                }
            }
        }
    }

    /**
     * Recursively decrypt fields in result data
     */
    async function decryptResultData(
        schema: SchemaDef,
        modelName: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const model = schema.models[modelName];
        if (!model) return;

        for (const [fieldName, value] of Object.entries(data)) {
            if (value === null || value === undefined || value === '') {
                continue;
            }

            const field = model.fields[fieldName];
            if (!field) continue;

            // Handle encrypted string fields
            if (isEncryptedField(field) && typeof value === 'string') {
                try {
                    data[fieldName] = await decryptValue(modelName, field, value);
                } catch (error) {
                    // If decryption fails, log warning and keep original value
                    console.warn(`Failed to decrypt field ${modelName}.${fieldName}:`, error);
                }
                continue;
            }

            // Handle relation fields (nested data)
            if (field.relation && value !== null) {
                const relatedModel = field.type;
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (typeof item === 'object' && item !== null) {
                            await decryptResultData(schema, relatedModel, item as Record<string, unknown>);
                        }
                    }
                } else if (typeof value === 'object') {
                    await decryptResultData(schema, relatedModel, value as Record<string, unknown>);
                }
            }
        }
    }

    return definePlugin<Schema, {}, {}>({
        id: 'encryption',
        name: 'Encryption Plugin',
        description: 'Automatically encrypts and decrypts fields marked with @encrypted',

        onQuery: async (ctx) => {
            const { model, operation, args, proceed, client } = ctx;
            const schema = (client as any).schema as SchemaDef;
            const modelDef = schema.models[model];

            // Check if this model has any encrypted fields
            if (!modelDef || !hasEncryptedFields(modelDef)) {
                return proceed(args);
            }

            // Clone args to avoid mutating original
            const processedArgs = args ? JSON.parse(JSON.stringify(args)) : undefined;

            // Handle write operations - encrypt data before writing
            if (
                operation === 'create' ||
                operation === 'update' ||
                operation === 'upsert' ||
                operation === 'createMany' ||
                operation === 'updateMany' ||
                operation === 'createManyAndReturn'
            ) {
                if (processedArgs?.data) {
                    if (Array.isArray(processedArgs.data)) {
                        for (const item of processedArgs.data) {
                            await encryptWriteData(schema, model, item);
                        }
                    } else {
                        await encryptWriteData(schema, model, processedArgs.data);
                    }
                }

                // Handle upsert create/update
                if (operation === 'upsert') {
                    if (processedArgs?.create) {
                        await encryptWriteData(schema, model, processedArgs.create);
                    }
                    if (processedArgs?.update) {
                        await encryptWriteData(schema, model, processedArgs.update);
                    }
                }
            }

            // Execute the query
            const result = await proceed(processedArgs);

            // Handle read operations - decrypt data after reading
            if (result !== null && result !== undefined) {
                if (Array.isArray(result)) {
                    for (const item of result) {
                        if (typeof item === 'object' && item !== null) {
                            await decryptResultData(schema, model, item as Record<string, unknown>);
                        }
                    }
                } else if (typeof result === 'object') {
                    await decryptResultData(schema, model, result as Record<string, unknown>);
                }
            }

            return result;
        },
    });
}
