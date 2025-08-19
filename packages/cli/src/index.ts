import { ZModelLanguageMetaData } from '@zenstackhq/language';
import colors from 'colors';
import { Command, CommanderError, Option } from 'commander';
import * as actions from './actions';
import { CliError } from './cli-error';
import { getVersion } from './utils/version-utils';

const generateAction = async (options: Parameters<typeof actions.generate>[0]): Promise<void> => {
    await actions.generate(options);
};

const migrateAction = async (command: string, options: any): Promise<void> => {
    await actions.migrate(command, options);
};

const dbAction = async (command: string, options: any): Promise<void> => {
    await actions.db(command, options);
};

const infoAction = async (projectPath: string): Promise<void> => {
    await actions.info(projectPath);
};

const initAction = async (projectPath: string): Promise<void> => {
    await actions.init(projectPath);
};

const checkAction = async (options: Parameters<typeof actions.check>[0]): Promise<void> => {
    await actions.check(options);
};

export function createProgram() {
    const program = new Command('zenstack');

    program.version(getVersion()!, '-v --version', 'display CLI version');

    const schemaExtensions = ZModelLanguageMetaData.fileExtensions.join(', ');

    program
        .description(
            `${colors.bold.blue(
                'ζ',
            )} ZenStack is the data layer for modern TypeScript apps.\n\nDocumentation: https://zenstack.dev.`,
        )
        .showHelpAfterError()
        .showSuggestionAfterError();

    const schemaOption = new Option(
        '--schema <file>',
        `schema file (with extension ${schemaExtensions}). Defaults to "zenstack/schema.zmodel" unless specified in package.json.`,
    );

    program
        .command('generate')
        .description('Run code generation plugins.')
        .addOption(schemaOption)
        .addOption(new Option('-o, --output <path>', 'default output directory for code generation'))
        .action(generateAction);

    const migrateCommand = program.command('migrate').description('Run database schema migration related tasks.');
    const migrationsOption = new Option('--migrations <path>', 'path that contains the "migrations" directory');

    migrateCommand
        .command('dev')
        .addOption(schemaOption)
        .addOption(new Option('-n, --name <name>', 'migration name'))
        .addOption(new Option('--create-only', 'only create migration, do not apply'))
        .addOption(migrationsOption)
        .description('Create a migration from changes in schema and apply it to the database.')
        .action((options) => migrateAction('dev', options));

    migrateCommand
        .command('reset')
        .addOption(schemaOption)
        .addOption(new Option('--force', 'skip the confirmation prompt'))
        .addOption(migrationsOption)
        .description('Reset your database and apply all migrations, all data will be lost.')
        .action((options) => migrateAction('reset', options));

    migrateCommand
        .command('deploy')
        .addOption(schemaOption)
        .addOption(migrationsOption)
        .description('Deploy your pending migrations to your production/staging database.')
        .action((options) => migrateAction('deploy', options));

    migrateCommand
        .command('status')
        .addOption(schemaOption)
        .addOption(migrationsOption)
        .description('Check the status of your database migrations.')
        .action((options) => migrateAction('status', options));

    migrateCommand
        .command('resolve')
        .addOption(schemaOption)
        .addOption(migrationsOption)
        .addOption(new Option('--applied <migration>', 'record a specific migration as applied'))
        .addOption(new Option('--rolled-back <migration>', 'record a specific migration as rolled back'))
        .description('Resolve issues with database migrations in deployment databases.')
        .action((options) => migrateAction('resolve', options));

    const dbCommand = program.command('db').description('Manage your database schema during development.');

    dbCommand
        .command('push')
        .description('Push the state from your schema to your database.')
        .addOption(schemaOption)
        .addOption(new Option('--accept-data-loss', 'ignore data loss warnings'))
        .addOption(new Option('--force-reset', 'force a reset of the database before push'))
        .action((options) => dbAction('push', options));

    program
        .command('info')
        .description('Get information of installed ZenStack packages.')
        .argument('[path]', 'project path', '.')
        .action(infoAction);

    program
        .command('init')
        .description('Initialize an existing project for ZenStack.')
        .argument('[path]', 'project path', '.')
        .action(initAction);

    program
        .command('check')
        .description('Check a ZModel schema for syntax or semantic errors.')
        .addOption(schemaOption)
        .action(checkAction);

    return program;
}

const program = createProgram();

program.parseAsync().catch((err) => {
    if (err instanceof CliError) {
        console.error(colors.red(err.message));
        process.exit(1);
    } else if (err instanceof CommanderError) {
        // errors are already reported, just exit
        process.exit(err.exitCode);
    } else {
        console.error(colors.red('An unexpected error occurred:'));
        console.error(err);
        process.exit(1);
    }
});
