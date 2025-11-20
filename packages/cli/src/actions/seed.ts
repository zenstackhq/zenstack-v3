import colors from 'colors';
import { execaCommand } from 'execa';
import { CliError } from '../cli-error';
import { getPkgJsonConfig } from './action-utils';

type Options = {
    noWarnings?: boolean;
    printStatus?: boolean;
};

/**
 * CLI action for seeding the database.
 */
export async function run(options: Options, args: string[]) {
    const pkgJsonConfig = getPkgJsonConfig(process.cwd());
    if (!pkgJsonConfig.seed) {
        if (!options.noWarnings) {
            console.warn(colors.yellow('No seed script defined in package.json. Skipping seeding.'));
        }
        return;
    }

    const command = `${pkgJsonConfig.seed}${args.length > 0 ? ' ' + args.join(' ') : ''}`;

    if (options.printStatus) {
        console.log(colors.gray(`Running seed script "${command}"...`));
    }

    try {
        await execaCommand(command, {
            stdout: 'inherit',
            stderr: 'inherit',
        });
    } catch (err) {
        console.error(colors.red(err instanceof Error ? err.message : String(err)));
        throw new CliError('Failed to seed the database. Please check the error message above for details.');
    }
}
