import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaSchemaGenerator } from '../prisma/schema-generator';
import { generate as generateTSSchema } from '../zmodel/ts-schema-generator';
import { getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    schema?: string;
    output?: string;
    silent?: boolean;
};

/**
 * CLI action for generating code from schema
 */
export async function run(options: Options) {
    const schemaFile = getSchemaFile(options.schema);

    const model = await loadSchemaDocument(schemaFile);
    const outputPath = options.output ?? path.dirname(schemaFile);

    // generate TS schema
    await generateTSSchema(schemaFile, path.join(outputPath, 'schema.ts'));

    // generate Prisma schema
    const prismaSchema = await new PrismaSchemaGenerator(model).generate();
    fs.writeFileSync(path.join(outputPath, 'schema.prisma'), prismaSchema);

    if (!options.silent) {
        console.log(colors.green('Generation completed successfully.'));
        console.log(`You can now create a ZenStack client with it.

\`\`\`
import { createClient } from '@zenstackhq/runtime';
import { schema } from '${outputPath}/schema';
import SQLite from 'better-sqlite3';

const db = createClient(schema, {
    // Kysely dialect configuration
    dialectConfig: {
        // e.g., for SQLite
        database: new SQLite(':memory:'),
    }
});
\`\`\`
`);
    }
}
