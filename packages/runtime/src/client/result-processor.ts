import Decimal from 'decimal.js';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { FieldDef, GetModels, SchemaDef } from '../schema';
import type { BuiltinType } from '../schema/schema';
import { ensureArray, getField } from './query-utils';

export class ResultProcessor<Schema extends SchemaDef> {
    constructor(private readonly schema: Schema) {}

    processResult(data: any, model: GetModels<Schema>, args?: any) {
        const result = this.doProcessResult(data, model);
        // deal with correcting the reversed order due to negative take
        this.fixReversedResult(result, model, args);
        return result;
    }

    private doProcessResult(data: any, model: GetModels<Schema>) {
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
        for (const [key, value] of Object.entries<any>(data)) {
            if (value === undefined || value === null) {
                continue;
            }

            if (key === '_count') {
                data[key] =
                    typeof value === 'string' ? JSON.parse(value) : value;
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
        return this.doProcessResult(
            relationData,
            fieldDef.type as GetModels<Schema>
        );
    }

    private transformScalar(value: unknown, type: BuiltinType) {
        return match(type)
            .with('Boolean', () => this.transformBoolean(value))
            .with('DateTime', () => this.transformDate(value))
            .with('Bytes', () => this.transformBytes(value))
            .with('Decimal', () => this.transformDecimal(value))
            .with('BigInt', () => this.transformBigInt(value))
            .otherwise(() => value);
    }

    private transformDecimal(value: unknown) {
        if (value instanceof Decimal) {
            return value;
        }
        invariant(
            typeof value === 'string' ||
                typeof value === 'number' ||
                value instanceof Decimal,
            `Expected string, number or Decimal, got ${typeof value}`
        );
        return new Decimal(value);
    }

    private transformBigInt(value: unknown) {
        if (typeof value === 'bigint') {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number',
            `Expected string or number, got ${typeof value}`
        );
        return BigInt(value);
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

    private transformBytes(value: unknown) {
        return Buffer.isBuffer(value) ? Uint8Array.from(value) : value;
    }

    private fixReversedResult(data: any, model: GetModels<Schema>, args: any) {
        if (
            Array.isArray(data) &&
            typeof args === 'object' &&
            args &&
            args.take !== undefined &&
            args.take < 0
        ) {
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
                if (!fieldDef?.relation) {
                    continue;
                }
                this.fixReversedResult(
                    row[field],
                    fieldDef.type as GetModels<Schema>,
                    value
                );
            }
        }
    }
}
