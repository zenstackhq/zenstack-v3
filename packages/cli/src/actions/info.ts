import colors from 'colors';
import path from 'node:path';

/**
 * CLI action for getting information about installed ZenStack packages
 */
export async function run(projectPath: string) {
    const packages = await getZenStackPackages(projectPath);
    if (!packages) {
        console.error('Unable to locate package.json. Are you in a valid project directory?');
        return;
    }

    console.log('Installed ZenStack Packages:');
    const versions = new Set<string>();
    for (const { pkg, version } of packages) {
        if (version) {
            versions.add(version);
        }
        console.log(`    ${colors.green(pkg.padEnd(20))}\t${version}`);
    }

    if (versions.size > 1) {
        console.warn(colors.yellow('WARNING: Multiple versions of Zenstack packages detected. This may cause issues.'));
    }
}

async function getZenStackPackages(projectPath: string): Promise<Array<{ pkg: string; version: string | undefined }>> {
    let pkgJson: {
        dependencies: Record<string, unknown>;
        devDependencies: Record<string, unknown>;
    };
    const resolvedPath = path.resolve(projectPath);
    try {
        pkgJson = (
            await import(path.join(resolvedPath, 'package.json'), {
                with: { type: 'json' },
            })
        ).default;
    } catch {
        return [];
    }

    const packages = Array.from(
        new Set(
            [...Object.keys(pkgJson.dependencies ?? {}), ...Object.keys(pkgJson.devDependencies ?? {})].filter(
                (p) => p.startsWith('@zenstackhq/') || p === 'zenstack',
            ),
        ),
    ).sort();

    const result = await Promise.all(
        packages.map(async (pkg) => {
            try {
                const depPkgJson = (
                    await import(`${pkg}/package.json`, {
                        with: { type: 'json' },
                    })
                ).default;
                if (depPkgJson.private) {
                    return undefined;
                }
                return { pkg, version: depPkgJson.version as string };
            } catch {
                return { pkg, version: undefined };
            }
        }),
    );

    return result.filter((p) => !!p);
}
