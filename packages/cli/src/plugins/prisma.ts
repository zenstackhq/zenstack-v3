import { PrismaSchemaGenerator, type CliPlugin } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';

const plugin: CliPlugin = {
    name: 'Prisma Schema Generator',
    statusText: 'Generating Prisma schema',
    async generate({ model, defaultOutputPath, pluginOptions }) {
        let outDir = defaultOutputPath;
        if (typeof pluginOptions['output'] === 'string') {
            outDir = path.resolve(defaultOutputPath, pluginOptions['output']);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }
        }
        const prismaSchema = await new PrismaSchemaGenerator(model).generate();
        fs.writeFileSync(path.join(outDir, 'schema.prisma'), prismaSchema);
    },
};

export default plugin;
