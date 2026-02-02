import type { CliPlugin } from '@zenstackhq/sdk';
import { isDataModel } from '@zenstackhq/sdk/ast';
import fs from 'node:fs';

const initialOutput = `// Generated searchable fields

export const SEARCHABLE_FIELDS_BY_MODEL = __searchableFieldsByModel__ as const
`;

const cliPlugin: CliPlugin = {
    name: 'Generate Searchable Fields',

    generate: ({ model, defaultOutputPath, pluginOptions }) => {
        console.log('\n🚧 Generate Searchable Fields Plugin');
        if (pluginOptions.report !== true) {
            return;
        }

        let output = initialOutput;

        const searchableFieldsByModel: Record<string, string[]> = {};
        const models: string[] = [];
        const modelDeclarations = model.declarations
            .filter(isDataModel)
            .slice() // make a shallow copy to avoid mutating the original
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const dm of modelDeclarations) {
            models.push(dm.name);
            searchableFieldsByModel[dm.name] = [];

            for (const field of dm.fields) {
                const hasSearchableAttribute = field.attributes.some(
                    (attribute) => attribute.decl.$refText === '@searchable',
                );

                if (hasSearchableAttribute) {
                    searchableFieldsByModel[dm.name]?.push(field.name);
                }
            }
        }

        output = output.replace(
            '__searchableFieldsByModel__',
            `{
${Object.entries(searchableFieldsByModel)
    .map(([model, fields]) => `  ${model}: [${fields.map((field) => `'${field}'`).join(', ')}],`)
    .join('\n')}
}`,
        );

        fs.writeFileSync(`${defaultOutputPath}/../constants/searchable-fields.ts`, output, 'utf-8');
    },
};

export default cliPlugin;
