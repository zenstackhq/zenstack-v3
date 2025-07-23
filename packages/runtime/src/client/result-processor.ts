import { invariant } from '@zenstackhq/common-helpers';
import Decimal from 'decimal.js';
import { match } from 'ts-pattern';
import type { BuiltinType, FieldDef, GetModels, SchemaDef } from '../schema';
import { DELEGATE_JOINED_FIELD_PREFIX } from './constants';
import { ensureArray, getField, getIdValues } from './query-utils';

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
                    const subRow = this.transformJson(value);

                    // process the sub-row
                    const subModel = key.slice(DELEGATE_JOINED_FIELD_PREFIX.length) as GetModels<Schema>;
                    const idValues = getIdValues(this.schema, subModel, subRow);
                    if (Object.values(idValues).some((v) => v === null || v === undefined)) {
                        // if the row doesn't have a valid id, the joined row doesn't exist
                        delete data[key];
                        continue;
                    }
                    const processedSubRow = this.processRow(subRow, subRow);

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
        return this.doProcessResult(relationData, fieldDef.type as GetModels<Schema>);
    }

    private transformScalar(value: unknown, type: BuiltinType) {
        if (this.schema.typeDefs && type in this.schema.typeDefs) {
            // typed JSON field
            return this.transformJson(value);
        } else {
            return match(type)
                .with('Boolean', () => this.transformBoolean(value))
                .with('DateTime', () => this.transformDate(value))
                .with('Bytes', () => this.transformBytes(value))
                .with('Decimal', () => this.transformDecimal(value))
                .with('BigInt', () => this.transformBigInt(value))
                .with('Json', () => this.transformJson(value))
                .otherwise(() => value);
        }
    }

    private transformDecimal(value: unknown) {
        if (value instanceof Decimal) {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number' || value instanceof Decimal,
            `Expected string, number or Decimal, got ${typeof value}`,
        );
        return new Decimal(value);
    }

    private transformBigInt(value: unknown) {
        if (typeof value === 'bigint') {
            return value;
        }
        invariant(
            typeof value === 'string' || typeof value === 'number',
            `Expected string or number, got ${typeof value}`,
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

    private transformJson(value: unknown) {
        return match(this.schema.provider.type)
            .with('sqlite', () => {
                // better-sqlite3 returns JSON as string
                invariant(typeof value === 'string', 'Expected string, got ' + typeof value);
                return JSON.parse(value as string);
            })
            .otherwise(() => value);
    }
}
