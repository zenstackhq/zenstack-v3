import { URI, Utils } from 'vscode-uri';

const base = URI.parse('file:/d/zenstack/');
const relative = URI.parse('file:./c/asdasd.db');
console.log(base);
console.log(relative);
console.log(Utils.resolvePath(base, relative.path));
// console.log(URI.parse('file:/c/asdasd.db'));
// console.log(URI.parse('file:./c/asdasd.db'));
