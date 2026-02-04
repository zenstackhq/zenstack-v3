import type { BuiltinType, FieldDef, GetModels, SchemaDef } from '../schema';
import { DELEGATE_JOINED_FIELD_PREFIX } from './constants';
import type { AuthType } from './contract';
import { getCrudDialect } from './crud/dialects';
import type { BaseCrudDialect } from './crud/dialects/base-dialect';
import type { ClientOptions, VirtualFieldContext, VirtualFieldFunction } from './options';
import { ensureArray, getField, getIdValues } from './query-utils';

export class ResultProcessor<Schema extends SchemaDef> {
    private dialect: BaseCrudDialect<Schema>;
    private readonly virtualFieldsOptions: Record<string, Record<string, VirtualFieldFunction>> | undefined;

    constructor(
        private readonly schema: Schema,
        options: ClientOptions<Schema>,
    ) {
        this.dialect = getCrudDialect(schema, options);
        this.virtualFieldsOptions = (options as any).virtualFields;
    }

    async processResult(data: any, model: GetModels<Schema>, args?: any, auth?: AuthType<Schema>) {
        const result = await this.doProcessResult(data, model, args, auth);
        // deal with correcting the reversed order due to negative take
        this.fixReversedResult(result, model, args);
        return result;
    }

    private async doProcessResult(data: any, model: GetModels<Schema>, args?: any, auth?: AuthType<Schema>) {
        if (Array.isArray(data)) {
            await Promise.all(
                data.map(async (row, i) => {
                    data[i] = await this.processRow(row, model, args, auth);
                }),
            );
            return data;
        } else {
            return this.processRow(data, model, args, auth);
        }
    }

    private async processRow(data: any, model: GetModels<Schema>, args?: any, auth?: AuthType<Schema>) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        for (const [key, value] of Object.entries<any>(data)) {
            if (value === undefined) {
                continue;
            }

            if (key === '_count') {
                // underlying database provider may return string for count
                data[key] = typeof value === 'string' ? JSON.parse(value) : value;
                continue;
            }

            if (key.startsWith(DELEGATE_JOINED_FIELD_PREFIX)) {
                // merge delegate descendant fields
                if (value) {
                    // descendant fields are packed as JSON
                    const subRow = this.dialect.transformOutput(value, 'Json', false);

                    // process the sub-row
                    const subModel = key.slice(DELEGATE_JOINED_FIELD_PREFIX.length) as GetModels<Schema>;
                    const idValues = getIdValues(this.schema, subModel, subRow);
                    if (Object.values(idValues).some((v) => v === null || v === undefined)) {
                        // if the row doesn't have a valid id, the joined row doesn't exist
                        delete data[key];
                        continue;
                    }
                    const processedSubRow = await this.processRow(subRow, subModel, args, auth);

                    // merge the sub-row into the main row
                    Object.assign(data, processedSubRow);
                }
                delete data[key];
                continue;
            }

            const fieldDef = getField(this.schema, model, key);
            if (!fieldDef) {
                continue;
            }

            if (value === null) {
                // scalar list defaults to empty array
                if (fieldDef.array && !fieldDef.relation && value === null) {
                    data[key] = [];
                }
                continue;
            }

            if (fieldDef.relation) {
                data[key] = await this.processRelation(value, fieldDef, args, auth);
            } else {
                data[key] = this.processFieldValue(value, fieldDef);
            }
        }

        await this.applyVirtualFields(data, model, args, auth);

        return data;
    }

    private processFieldValue(value: unknown, fieldDef: FieldDef) {
        const type = fieldDef.type as BuiltinType;
        if (Array.isArray(value)) {
            value.forEach((v, i) => (value[i] = this.dialect.transformOutput(v, type, false)));
            return value;
        } else {
            return this.dialect.transformOutput(value, type, !!fieldDef.array);
        }
    }

    private async processRelation(value: unknown, fieldDef: FieldDef, args?: any, auth?: AuthType<Schema>) {
        let relationData = value;
        if (typeof value === 'string') {
            // relation can be returned as a JSON string
            try {
                relationData = JSON.parse(value);
            } catch {
                return value;
            }
        }
        return this.doProcessResult(relationData, fieldDef.type as GetModels<Schema>, args, auth);
    }

    private async applyVirtualFields(data: any, model: GetModels<Schema>, args?: any, auth?: AuthType<Schema>) {
        if (!data || typeof data !== 'object') {
            return;
        }

        const modelDef = this.schema.models[model as string];
        if (!modelDef?.virtualFields || !this.virtualFieldsOptions) {
            return;
        }

        const modelVirtualFieldOptions = this.virtualFieldsOptions[model as string];
        if (!modelVirtualFieldOptions) {
            return;
        }

        const virtualFieldNames = Object.keys(modelDef.virtualFields);
        const selectClause = args?.select;
        const omitClause = args?.omit;

        // Build the context once for all virtual fields
        const context: VirtualFieldContext<Schema> = { auth };

        await Promise.all(
            virtualFieldNames.map(async (fieldName) => {
                // Skip if select clause exists and doesn't include this virtual field
                if (selectClause && !selectClause[fieldName]) {
                    return;
                }

                // Skip if omit clause includes this virtual field
                if (omitClause?.[fieldName]) {
                    return;
                }

                const virtualFn = modelVirtualFieldOptions[fieldName]!;

                data[fieldName] = await virtualFn({ ...data }, context);
            }),
        );
    }

    private fixReversedResult(data: any, model: GetModels<Schema>, args: any) {
        if (!data) {
            return;
        }

        if (Array.isArray(data) && typeof args === 'object' && args && args.take !== undefined && args.take < 0) {
            data.reverse();
        }

        const selectInclude = args?.include ?? args?.select;
        if (!selectInclude) {
            return;
        }

        for (const row of ensureArray(data)) {
            for (const [field, value] of Object.entries<any>(selectInclude)) {
                if (typeof value !== 'object' || !value) {
                    continue;
                }
                const fieldDef = getField(this.schema, model, field);
                if (!fieldDef || !fieldDef.relation || !fieldDef.array) {
                    continue;
                }
                this.fixReversedResult(row[field], fieldDef.type as GetModels<Schema>, value);
            }
        }
    }
}
