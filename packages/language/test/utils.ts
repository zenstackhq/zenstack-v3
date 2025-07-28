import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { loadDocument } from '../src';
import { expect } from 'vitest';
import { invariant } from '@zenstackhq/common-helpers';

export async function loadSchema(schema: string) {
    // create a temp file
    const tempFile = path.join(os.tmpdir(), `zenstack-schema-${crypto.randomUUID()}.zmodel`);
    fs.writeFileSync(tempFile, schema);
    const r = await loadDocument(tempFile);
    expect(r.success).toBe(true);
    invariant(r.success);
    return r.model;
}

export async function loadSchemaWithError(schema: string, error: string | RegExp) {
    // create a temp file
    const tempFile = path.join(os.tmpdir(), `zenstack-schema-${crypto.randomUUID()}.zmodel`);
    fs.writeFileSync(tempFile, schema);
    const r = await loadDocument(tempFile);
    expect(r.success).toBe(false);
    invariant(!r.success);
    if (typeof error === 'string') {
        expect(r.errors.some((e) => e.toString().toLowerCase().includes(error.toLowerCase()))).toBe(true);
    } else {
        expect(r.errors.some((e) => error.test(e))).toBe(true);
    }
}
