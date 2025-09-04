import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env['TELEMETRY_TRACKING_TOKEN'] ?? '';

console.log('TELEMETRY_TRACKING_TOKEN:', token?.[0]);

const filesToProcess = ['dist/index.js', 'dist/index.cjs'];
const _dirname = path.dirname(fileURLToPath(import.meta.url));

for (const file of filesToProcess) {
    console.log(`Processing ${file} for telemetry token...`);
    const content = fs.readFileSync(path.join(_dirname, '..', file), 'utf-8');
    const updatedContent = content.replace('<TELEMETRY_TRACKING_TOKEN>', token);
    fs.writeFileSync(file, updatedContent, 'utf-8');
}
