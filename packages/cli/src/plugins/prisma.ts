import { PrismaSchemaGenerator, type CliPlugin } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';

const plugin: CliPlugin = {
    name: 'Prisma Schema Generator',
    statusText: 'Generating Prisma schema',
    async generate({ model, defaultOutputPath, pluginOptions }) {
        let outFile = path.join(defaultOutputPath, 'schema.prisma');
        if (typeof pluginOptions['output'] === 'string') {
            outFile = path.resolve(defaultOutputPath, pluginOptions['output']);
            if (!fs.existsSync(path.dirname(outFile))) {
                fs.mkdirSync(path.dirname(outFile), { recursive: true });
            }
        }
        const prismaSchema = await new PrismaSchemaGenerator(model).generate();
        fs.writeFileSync(outFile, prismaSchema);
    },
};

export default plugin;
