import type { CliPlugin } from '@zenstackhq/sdk';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';

const plugin: CliPlugin = {
    name: 'TypeScript Schema Generator',
    statusText: 'Generating TypeScript schema',
    async generate({ model, defaultOutputPath, pluginOptions }) {
        let ourDir = defaultOutputPath;
        if (typeof pluginOptions['output'] === 'string') {
            ourDir = path.resolve(defaultOutputPath, pluginOptions['output']);
            if (!fs.existsSync(ourDir)) {
                fs.mkdirSync(ourDir, { recursive: true });
            }
        }
        await new TsSchemaGenerator().generate(model, ourDir);
    },
};

export default plugin;
