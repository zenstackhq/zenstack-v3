import { Array } from 'effect';
import type { SchemaDef } from '../../schema/schema';
import { requireField, requireIdFields } from '../query-utils';
import type { FindArgs } from '../types';

export function assembleResult(
    schema: SchemaDef,
    model: string,
    data: any,
    args: FindArgs<SchemaDef, string> | undefined
) {
    if (!data) {
        return data;
    }

    const arrayData = Array.isArray(data) ? data : [data];
    return doAssembleResult(schema, model, '$', arrayData, args);
}

function doAssembleResult(
    schema: SchemaDef,
    model: string,
    path: string,
    data: any[],
    args: FindArgs<SchemaDef, string> | undefined
) {
    const grouped = Array.groupBy(data, (item) =>
        getEntityKey(schema, model, path, item)
    );
    return Object.values(grouped).map((rows) => {
        const entity = constructEntity(schema, model, path, rows, args);
        return entity;
    });
}

function getEntityKey(
    schema: SchemaDef,
    model: string,
    path: string,
    data: any
) {
    const idFields = requireIdFields(schema, model);
    return JSON.stringify(
        idFields.reduce((acc, f) => ({ ...acc, [f]: data[`${path}>${f}`] }), {})
    );
}

function constructEntity(
    schema: SchemaDef,
    model: string,
    path: string,
    rows: any[],
    args: FindArgs<SchemaDef, string> | undefined
) {
    const result: any = {};

    // scalar fields
    for (const [k, v] of Object.entries(rows[0])) {
        if (!k.startsWith(`${path}>`)) {
            continue;
        }

        const field = k.substring(`${path}>`.length).split('>')[0];
        if (!field) {
            continue;
        }

        const fieldDef = requireField(schema, model, field);
        if (!fieldDef.relation) {
            if (!args?.select || args?.select[field]) {
                result[field] = v;
            }
        }
    }

    // relation fields
    const selectInclude = args?.select ?? args?.include;
    if (selectInclude) {
        for (const [field, payload] of Object.entries(selectInclude)) {
            if (!payload) {
                continue;
            }
            const fieldDef = requireField(schema, model, field);
            if (!fieldDef.relation) {
                continue;
            }

            const childSelectInclude =
                typeof payload === 'object'
                    ? (payload as any)[field] ?? (payload as any)[field]
                    : undefined;
            const child = doAssembleResult(
                schema,
                fieldDef.type,
                `${path}>${field}`,
                rows,
                childSelectInclude
            );
            if (fieldDef.array) {
                result[field] = child;
            } else {
                result[field] = child[0] ?? null;
            }
        }
    }

    return result;
}
