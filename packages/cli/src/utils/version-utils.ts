import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function getVersion() {
    try {
        // isomorphic __dirname
        const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
        return JSON.parse(fs.readFileSync(path.join(_dirname, '../package.json'), 'utf8')).version;
    } catch {
        return undefined;
    }
}
