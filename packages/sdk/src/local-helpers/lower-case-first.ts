export function lowerCaseFirst(input: string) {
    return input.charAt(0).toLowerCase() + input.slice(1);
}

export { lowerCaseFirst as uncapitalize };
