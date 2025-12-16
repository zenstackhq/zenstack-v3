import { invariant } from '@zenstackhq/common-helpers';
import { isPlugin, LiteralExpr, Plugin, type Model } from '@zenstackhq/language/ast';
import { getLiteral, getLiteralArray } from '@zenstackhq/language/utils';
import { type CliPlugin } from '@zenstackhq/sdk';
import colors from 'colors';
import path from 'node:path';
import ora, { type Ora } from 'ora';
import { CliError } from '../cli-error';
import * as corePlugins from '../plugins';
import { getPkgJsonConfig, getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    schema?: string;
    output?: string;
    silent: boolean;
    lite: boolean;
    liteOnly: boolean;
};

/**
 * CLI action for generating code from schema
 */
export async function run(options: Options) {
    const start = Date.now();

    const schemaFile = getSchemaFile(options.schema);

    const model = await loadSchemaDocument(schemaFile);
    const outputPath = getOutputPath(options, schemaFile);

    await runPlugins(schemaFile, model, outputPath, options);

    if (!options.silent) {
        console.log(colors.green(`Generation completed successfully in ${Date.now() - start}ms.\n`));
        console.log(`You can now create a ZenStack client with it.

\`\`\`ts
import { ZenStackClient } from '@zenstackhq/orm';
import { schema } from '${path.relative('.', outputPath)}/schema';

const client = new ZenStackClient(schema, {
    dialect: { ... }
});
\`\`\`

Check documentation: https://zenstack.dev/docs/3.x`);
    }
}

function getOutputPath(options: Options, schemaFile: string) {
    if (options.output) {
        return options.output;
    }
    const pkgJsonConfig = getPkgJsonConfig(process.cwd());
    if (pkgJsonConfig.output) {
        return pkgJsonConfig.output;
    } else {
        return path.dirname(schemaFile);
    }
}

async function runPlugins(schemaFile: string, model: Model, outputPath: string, options: Options) {
    const plugins = model.declarations.filter(isPlugin);
    const processedPlugins: { cliPlugin: CliPlugin; pluginOptions: Record<string, unknown> }[] = [];

    for (const plugin of plugins) {
        const provider = getPluginProvider(plugin);

        let cliPlugin: CliPlugin | undefined;
        if (provider.startsWith('@core/')) {
            cliPlugin = (corePlugins as any)[provider.slice('@core/'.length)];
            if (!cliPlugin) {
                throw new CliError(`Unknown core plugin: ${provider}`);
            }
        } else {
            let moduleSpec = provider;
            if (moduleSpec.startsWith('.')) {
                // relative to schema's path
                moduleSpec = path.resolve(path.dirname(schemaFile), moduleSpec);
            }
            try {
                cliPlugin = (await import(moduleSpec)).default as CliPlugin;
            } catch {
                // plugin may not export a generator so we simply ignore the error here
            }
        }

        if (cliPlugin) {
            const pluginOptions = getPluginOptions(plugin);

            // merge CLI options
            if (provider === '@core/typescript') {
                if (pluginOptions['lite'] === undefined) {
                    pluginOptions['lite'] = options.lite;
                }
                if (pluginOptions['liteOnly'] === undefined) {
                    pluginOptions['liteOnly'] = options.liteOnly;
                }
            }

            processedPlugins.push({ cliPlugin, pluginOptions });
        }
    }

    const defaultPlugins = [
        {
            plugin: corePlugins['typescript'],
            options: { lite: options.lite, liteOnly: options.liteOnly },
        },
    ];
    defaultPlugins.forEach(({ plugin, options }) => {
        if (!processedPlugins.some((p) => p.cliPlugin === plugin)) {
            processedPlugins.push({ cliPlugin: plugin, pluginOptions: options });
        }
    });

    for (const { cliPlugin, pluginOptions } of processedPlugins) {
        invariant(
            typeof cliPlugin.generate === 'function',
            `Plugin ${cliPlugin.name} does not have a generate function`,
        );

        // run plugin generator
        let spinner: Ora | undefined;

        if (!options.silent) {
            spinner = ora(cliPlugin.statusText ?? `Running plugin ${cliPlugin.name}`).start();
        }
        try {
            await cliPlugin.generate({
                schemaFile,
                model,
                defaultOutputPath: outputPath,
                pluginOptions,
            });
            spinner?.succeed();
        } catch (err) {
            spinner?.fail();
            console.error(err);
        }
    }
}

function getPluginProvider(plugin: Plugin) {
    const providerField = plugin.fields.find((f) => f.name === 'provider');
    invariant(providerField, `Plugin ${plugin.name} does not have a provider field`);
    const provider = (providerField.value as LiteralExpr).value as string;
    return provider;
}

function getPluginOptions(plugin: Plugin): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of plugin.fields) {
        if (field.name === 'provider') {
            continue; // skip provider
        }
        const value = getLiteral(field.value) ?? getLiteralArray(field.value);
        if (value === undefined) {
            console.warn(`Plugin "${plugin.name}" option "${field.name}" has unsupported value, skipping`);
            continue;
        }
        result[field.name] = value;
    }
    return result;
}
