import { ZModelLanguageMetaData } from '@zenstackhq/language';
import colors from 'colors';
import { Command, CommanderError, Option } from 'commander';
import * as actions from './actions';
import { CliError } from './cli-error';
import { telemetry } from './telemetry';
import { checkNewVersion, getVersion } from './utils/version-utils';

const generateAction = async (options: Parameters<typeof actions.generate>[0]): Promise<void> => {
    await telemetry.trackCommand('generate', () => actions.generate(options));
};

const migrateAction = async (subCommand: string, options: any): Promise<void> => {
    await telemetry.trackCommand(`migrate ${subCommand}`, () => actions.migrate(subCommand, options));
};

const dbAction = async (subCommand: string, options: any): Promise<void> => {
    await telemetry.trackCommand(`db ${subCommand}`, () => actions.db(subCommand, options));
};

const infoAction = async (projectPath: string): Promise<void> => {
    await telemetry.trackCommand('info', () => actions.info(projectPath));
};

const initAction = async (projectPath: string): Promise<void> => {
    await telemetry.trackCommand('init', () => actions.init(projectPath));
};

const checkAction = async (options: Parameters<typeof actions.check>[0]): Promise<void> => {
    await telemetry.trackCommand('check', () => actions.check(options));
};

function createProgram() {
    const program = new Command('zen');

    program.version(getVersion()!, '-v --version', 'display CLI version');

    const schemaExtensions = ZModelLanguageMetaData.fileExtensions.join(', ');

    program
        .description(
            `${colors.bold.blue(
                'ζ',
            )} ZenStack is the data layer for modern TypeScript apps.\n\nDocumentation: https://zenstack.dev/docs/3.x`,
        )
        .showHelpAfterError()
        .showSuggestionAfterError();

    const schemaOption = new Option(
        '--schema <file>',
        `schema file (with extension ${schemaExtensions}). Defaults to "zenstack/schema.zmodel" unless specified in package.json.`,
    );

    const noVersionCheckOption = new Option('--no-version-check', 'do not check for new version');

    program
        .command('generate')
        .description('Run code generation plugins.')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
        .addOption(new Option('-o, --output <path>', 'default output directory for code generation'))
        .addOption(new Option('--silent', 'suppress all output except errors').default(false))
        .action(generateAction);

    const migrateCommand = program.command('migrate').description('Run database schema migration related tasks.');
    const migrationsOption = new Option('--migrations <path>', 'path that contains the "migrations" directory');

    migrateCommand
        .command('dev')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
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
        .addOption(noVersionCheckOption)
        .description('Reset your database and apply all migrations, all data will be lost.')
        .action((options) => migrateAction('reset', options));

    migrateCommand
        .command('deploy')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
        .addOption(migrationsOption)
        .description('Deploy your pending migrations to your production/staging database.')
        .action((options) => migrateAction('deploy', options));

    migrateCommand
        .command('status')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
        .addOption(migrationsOption)
        .description('Check the status of your database migrations.')
        .action((options) => migrateAction('status', options));

    migrateCommand
        .command('resolve')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
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
        .addOption(noVersionCheckOption)
        .addOption(new Option('--accept-data-loss', 'ignore data loss warnings'))
        .addOption(new Option('--force-reset', 'force a reset of the database before push'))
        .action((options) => dbAction('push', options));

    dbCommand
        .command('pull')
        .description('Introspect your database.')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
        .addOption(new Option('--out <path>', 'add custom output path for the introspected schema'))
        .action((options) => dbAction('pull', options));

    program
        .command('info')
        .description('Get information of installed ZenStack packages.')
        .argument('[path]', 'project path', '.')
        .addOption(noVersionCheckOption)
        .action(infoAction);

    program
        .command('init')
        .description('Initialize an existing project for ZenStack.')
        .argument('[path]', 'project path', '.')
        .addOption(noVersionCheckOption)
        .action(initAction);

    program
        .command('check')
        .description('Check a ZModel schema for syntax or semantic errors.')
        .addOption(schemaOption)
        .addOption(noVersionCheckOption)
        .action(checkAction);

    program.hook('preAction', async (_thisCommand, actionCommand) => {
        if (actionCommand.getOptionValue('versionCheck') !== false) {
            await checkNewVersion();
        }
    });

    return program;
}

async function main() {
    let exitCode = 0;

    const program = createProgram();
    program.exitOverride();

    try {
        await telemetry.trackCli(async () => {
            await program.parseAsync();
        });
    } catch (e) {
        if (e instanceof CommanderError) {
            // ignore
            exitCode = e.exitCode;
        } else if (e instanceof CliError) {
            // log
            console.error(colors.red(e.message));
            exitCode = 1;
        } else {
            console.error(colors.red(`Unhandled error: ${e}`));
            exitCode = 1;
        }
    }

    if (telemetry.isTracking) {
        // give telemetry a chance to send events before exit
        setTimeout(() => {
            process.exit(exitCode);
        }, 200);
    } else {
        process.exit(exitCode);
    }
}

main();
