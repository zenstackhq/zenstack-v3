import fs from 'fs';
import path from 'path';

/**
 * A type named FindUp that takes a type parameter e which extends boolean.
 */
export type FindUpResult<Multiple extends boolean> = Multiple extends true ? string[] | undefined : string | undefined;

/**
 * Find and return file paths by searching parent directories based on the given names list and current working directory (cwd) path.
 * Optionally return a single path or multiple paths.
 * If multiple allowed, return all paths found.
 * If no paths are found, return undefined.
 *
 * @param names An array of strings representing names to search for within the directory
 * @param cwd A string representing the current working directory
 * @param multiple A boolean flag indicating whether to search for multiple levels. Useful for finding node_modules directories...
 * @param An array of strings representing the accumulated results used in multiple results
 * @returns Path(s) to a specific file or folder within the directory or parent directories
 */
export function findUp<Multiple extends boolean = false>(
    names: string[],
    cwd: string = process.cwd(),
    multiple: Multiple = false as Multiple,
    result: string[] = [],
): FindUpResult<Multiple> {
    if (!names.some((name) => !!name)) return undefined;
    const target = names.find((name) => fs.existsSync(path.join(cwd, name)));
    if (multiple === false && target) return path.join(cwd, target) as FindUpResult<Multiple>;
    if (target) result.push(path.join(cwd, target));
    const up = path.resolve(cwd, '..');
    if (up === cwd) return (multiple && result.length > 0 ? result : undefined) as FindUpResult<Multiple>; // it'll fail anyway
    return findUp(names, up, multiple, result);
}
