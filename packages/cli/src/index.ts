import { ZModelLanguageMetaData } from '@zenstackhq/language';
import colors from 'colors';
import { Command, Option } from 'commander';
import * as actions from './actions';
import { getVersion } from './utils/version-utils';

export const infoAction = async (projectPath: string): Promise<void> => {
    await actions.info(projectPath);
};

export const generateAction = async (
    options: Parameters<typeof actions.generate>[0]
): Promise<void> => {
    await actions.generate(options);
};

export const migrateAction = async (
    command: string,
    options: any
): Promise<void> => {
    await actions.migrate(command, options);
};

export function createProgram() {
    const program = new Command('zenstack');

    program.version(getVersion()!, '-v --version', 'display CLI version');

    const schemaExtensions = ZModelLanguageMetaData.fileExtensions.join(', ');

    program
        .description(
            `${colors.bold.blue(
                'ζ'
            )} ZenStack is a Prisma power pack for building full-stack apps.\n\nDocumentation: https://zenstack.dev.`
        )
        .showHelpAfterError()
        .showSuggestionAfterError();

    const schemaOption = new Option(
        '--schema <file>',
        `schema file (with extension ${schemaExtensions}). Defaults to "schema.zmodel" unless specified in package.json.`
    );

    program
        .command('info')
        .description(
            'Get information of installed ZenStack and related packages.'
        )
        .argument('[path]', 'project path', '.')
        .action(infoAction);

    program
        .command('generate')
        .description('Run code generation.')
        .addOption(schemaOption)
        .addOption(
            new Option(
                '-o, --output <path>',
                'default output directory for core plugins'
            )
        )
        .action(generateAction);

    const migrateCommand = program
        .command('migrate')
        .description('Run migration.');

    migrateCommand
        .command('dev')
        .addOption(schemaOption)
        .addOption(new Option('-n, --name <name>', 'migration name'))
        .addOption(
            new Option('--create-only', 'only create migration, do not apply')
        )
        .description(
            'Create a migration from changes in schema and apply it to the database.'
        )
        .action((options) => migrateAction('dev', options));

    migrateCommand
        .command('reset')
        .addOption(schemaOption)
        .addOption(new Option('--force', 'skip the confirmation prompt'))
        .description(
            'Reset your database and apply all migrations, all data will be lost.'
        )
        .action((options) => migrateAction('reset', options));

    migrateCommand
        .command('deploy')
        .addOption(schemaOption)
        .description(
            'deploy your pending migrations to your production/staging database.'
        )
        .action((options) => migrateAction('deploy', options));

    migrateCommand
        .command('status')
        .addOption(schemaOption)
        .description('check the status of your database migrations.')
        .action((options) => migrateAction('status', options));

    return program;
}

const program = createProgram();
program.parse(process.argv);
