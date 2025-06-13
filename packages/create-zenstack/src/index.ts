import colors from 'colors';
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import ora from 'ora';
import { STARTER_MAIN_TS, STARTER_ZMODEL } from './templates';

// detect package manager
const npmAgent = process.env['npm_config_user_agent'];
let agent = 'npm';
let agentExec = 'npx';
let initCommand = 'npm init -y';
let saveDev = '--save-dev';

if (npmAgent?.includes('pnpm')) {
    agent = 'pnpm';
    initCommand = 'pnpm init';
    agentExec = 'pnpm';
} else if (npmAgent?.includes('yarn')) {
    agent = 'yarn';
    initCommand = 'yarn init';
    agentExec = 'npx';
    saveDev = '--dev';
} else if (npmAgent?.includes('bun')) {
    agent = 'bun';
    agentExec = 'bun';
    initCommand = 'bun init -y -m';
}

const program = new Command('create-zenstack');

program.arguments('<project-name>').action((projectName) => {
    initProject(projectName);
});

program.parse(process.argv);

function initProject(name: string) {
    // create folder
    if (fs.existsSync(name)) {
        console.log(colors.red(`Directory ${name} already exists.`));
        process.exit(1);
    }
    fs.mkdirSync(name);
    process.chdir(name);

    console.log(colors.gray(`Using package manager: ${agent}`));

    // initialize project
    execSync(initCommand);

    // install packages
    const packages = [
        { name: '@zenstackhq/cli', dev: true },
        { name: '@zenstackhq/runtime', dev: false },
        { name: 'better-sqlite3', dev: false },
        { name: 'tsx', dev: true },
    ];
    for (const pkg of packages) {
        installPackage(pkg);
    }

    // create schema.zmodel
    fs.mkdirSync('zenstack');
    fs.writeFileSync('zenstack/schema.zmodel', STARTER_ZMODEL);

    // create main.ts
    fs.writeFileSync('main.ts', STARTER_MAIN_TS);

    // run `zenstack generate`
    runCommand(`${agentExec} zenstack generate`, 'Running `zenstack generate`');

    // run `zenstack db push`
    runCommand(`${agentExec} zenstack db push`, 'Running `zenstack db push`');
}

function installPackage(pkg: { name: string; dev: boolean }) {
    runCommand(
        `${agent} install ${pkg.name} ${pkg.dev ? saveDev : ''}`,
        `Installing "${pkg.name}"`
    );
}

function runCommand(cmd: string, status: string) {
    const spinner = ora(status).start();
    try {
        execSync(cmd);
        spinner.succeed();
    } catch (e) {
        spinner.fail();
        throw e;
    }
}
