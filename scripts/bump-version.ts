import * as fs from 'node:fs';
import { glob } from 'glob';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { fileURLToPath } from 'node:url';

const excludes = ['packages/ide/vscode/package.json'];

const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

function getWorkspacePackageJsonFiles(workspaceFile: string): string[] {
    const workspaceYaml = fs.readFileSync(workspaceFile, 'utf8');
    const workspace = yaml.parse(workspaceYaml) as { packages?: string[] };
    if (!workspace.packages) throw new Error('No "packages" key found in pnpm-workspace.yaml');

    const files = new Set<string>();

    // include all package.json files in the workspace
    const rootDir = path.dirname(workspaceFile);
    for (const pattern of workspace.packages) {
        const matches = glob.sync(path.join(pattern, 'package.json'), {
            cwd: rootDir,
            absolute: true,
        });
        matches.filter((f) => !f.includes('node_modules')).forEach((f) => files.add(f));
    }

    // include root package.json
    files.add(path.resolve(_dirname, '../package.json'));

    const result = Array.from(files).filter((f) => !excludes.some((e) => f.endsWith(e)));
    return result;
}

function incrementVersion(version: string): string {
    const parts = version.split('.');
    const last = parts.length - 1;
    const lastNum = parseInt(parts[last], 10);
    if (isNaN(lastNum)) throw new Error(`Invalid version: ${version}`);
    parts[last] = (lastNum + 1).toString();
    return parts.join('.');
}

// find all package.json files in the workspace
const workspaceFile = path.resolve(_dirname, '../pnpm-workspace.yaml');
const packageFiles = getWorkspacePackageJsonFiles(workspaceFile);

// get version from root package.json
const rootPackageJson = path.resolve(_dirname, '../package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf8')) as { version?: string };
if (!rootPkg.version) throw new Error('No "version" key found in package.json');
const rootVersion = rootPkg.version;
const newVersion = incrementVersion(rootVersion);

for (const file of packageFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const pkg = JSON.parse(content) as { version?: string };
    if (pkg.version) {
        // do a string replace from oldVersion to newVersion
        const oldVersion = pkg.version;
        const newContent = content.replace(`"version": "${oldVersion}"`, `"version": "${newVersion}"`);
        fs.writeFileSync(file, newContent);
        console.log(`Updated ${file}: ${oldVersion} -> ${newVersion}`);
    }
}

if (process.env.GITHUB_OUTPUT) {
    // CI output
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_version=${newVersion}\n`);
}
