import { match } from 'ts-pattern';
import type { FieldDef, GetModels, SchemaDef } from '../schema';
import type { BuiltinType } from '../schema/schema';
import { getField } from './query-utils';

export class ResultProcessor<Schema extends SchemaDef> {
    constructor(private readonly schema: Schema) {}

    processResult(data: any, model: GetModels<Schema>) {
        if (Array.isArray(data)) {
            data.forEach((row, i) => (data[i] = this.processRow(row, model)));
            return data;
        } else {
            return this.processRow(data, model);
        }
    }

    private processRow(data: any, model: GetModels<Schema>) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) {
                continue;
            }
            const fieldDef = getField(this.schema, model, key);
            if (!fieldDef) {
                continue;
            }
            if (fieldDef.relation) {
                data[key] = this.processRelation(value, fieldDef);
            } else {
                data[key] = this.processFieldValue(value, fieldDef);
            }
        }
        return data;
    }

    private processFieldValue(value: unknown, fieldDef: FieldDef) {
        const type = fieldDef.type as BuiltinType;
        if (Array.isArray(value)) {
            value.forEach((v, i) => (value[i] = this.transformScalar(v, type)));
            return value;
        } else {
            return this.transformScalar(value, type);
        }
    }

    private processRelation(value: unknown, fieldDef: FieldDef) {
        let relationData = value;
        if (typeof value === 'string') {
            // relation can be returned as a JSON string
            try {
                relationData = JSON.parse(value);
            } catch {
                return value;
            }
        }
        return this.processResult(
            relationData,
            fieldDef.type as GetModels<Schema>
        );
    }

    private transformScalar(value: unknown, type: BuiltinType) {
        return match(type)
            .with('Boolean', () => this.transformBoolean(value))
            .with('DateTime', () => this.transformDate(value))
            .otherwise(() => value);
    }

    private transformBoolean(value: unknown) {
        return !!value;
    }

    private transformDate(value: unknown) {
        if (typeof value === 'number') {
            return new Date(value);
        } else if (typeof value === 'string') {
            return new Date(Date.parse(value));
        } else {
            return value;
        }
    }
}
