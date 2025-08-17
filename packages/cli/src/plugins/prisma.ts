import { PrismaSchemaGenerator, type CliPlugin } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';

const plugin: CliPlugin = {
    name: 'Prisma Schema Generator',
    statusText: 'Generating Prisma schema',
    async generate({ model, defaultOutputPath, pluginOptions }) {
        let outFile = path.join(defaultOutputPath, 'schema.prisma');
        if (typeof pluginOptions['output'] === 'string') {
            const outDir = path.resolve(defaultOutputPath, pluginOptions['output']);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }
            outFile = path.join(outDir, 'schema.prisma');
        }
        const prismaSchema = await new PrismaSchemaGenerator(model).generate();
        fs.writeFileSync(outFile, prismaSchema);
    },
};

export default plugin;
