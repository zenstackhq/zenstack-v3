import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
    },
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    format: ['esm', 'cjs'],
    onSuccess: async () => {
        console.log('TELEMETRY_TRACKING_TOKEN:', process.env['TELEMETRY_TRACKING_TOKEN']);
        if (!process.env['TELEMETRY_TRACKING_TOKEN']) {
            return;
        }
        const filesToProcess = ['dist/index.js', 'dist/index.cjs'];
        for (const file of filesToProcess) {
            console.log(`Processing ${file} for telemetry token...`);
            const content = fs.readFileSync(path.join(__dirname, file), 'utf-8');
            const updatedContent = content.replace(
                '<TELEMETRY_TRACKING_TOKEN>',
                process.env['TELEMETRY_TRACKING_TOKEN'],
            );
            fs.writeFileSync(file, updatedContent, 'utf-8');
        }
    },
});
